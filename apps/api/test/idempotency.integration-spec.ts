import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IdempotencyRecordStatus, type PrismaClient } from '@fraterunion-payments/database';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigService } from '../src/config/app-config.service';
import { DatabaseService } from '../src/database/database.service';
import { hashIdempotencyKey } from '../src/idempotency/idempotency';
import {
  IdempotencyKeyConflictException,
  IdempotencyOperationInProgressException,
  isIdempotencyUnique,
} from '../src/idempotency/idempotency.exceptions';
import { IdempotencyService } from '../src/idempotency/idempotency.service';
import {
  IDEMPOTENCY_RESOURCE_TYPES,
  IDEMPOTENCY_SCOPES,
} from '../src/idempotency/idempotency.types';
import { PaymentsService } from '../src/payments/payments.service';
import { RefundsService } from '../src/refunds/refunds.service';
import { deleteTenantsForTests, teardownRealPgSuite } from './support/immutable-audit-cleanup';
import { resolveDatabaseUrl } from './support/test-database-url';
import { createTestEnvironment } from './support/test-environment';
import { testEmail, testSlug } from './support/test-ownership';

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl === undefined) {
  console.warn(
    'Skipping idempotency integration suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)(
  'Financial idempotency (real PostgreSQL)',
  () => {
    let app: NestExpressApplication;
    let db: PrismaClient;
    let idempotency: IdempotencyService;
    let payments: PaymentsService;
    let refunds: RefundsService;

    const createdUserIds = new Set<string>();
    const createdOrgIds = new Set<string>();
    const actor = { type: 'SYSTEM' as const };

    beforeAll(async () => {
      if (databaseUrl === undefined) {
        throw new Error('DATABASE_URL must be set');
      }
      const environment = createTestEnvironment({ databaseUrl, swaggerEnabled: false });
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule.forRoot(environment)],
      }).compile();
      app = moduleRef.createNestApplication<NestExpressApplication>();
      configureApp(app, app.get(AppConfigService));
      await app.init();
      db = app.get(DatabaseService).getClient();
      idempotency = app.get(IdempotencyService);
      payments = app.get(PaymentsService);
      refunds = app.get(RefundsService);
      await deleteTenantsForTests(db);
    });

    afterAll(async () => {
      await teardownRealPgSuite({
        app,
        db,
        organizationIds: [...createdOrgIds],
        userIds: [...createdUserIds],
      });
    });

    async function registerOrg(): Promise<string> {
      const suffix = randomUUID().slice(0, 8);
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail(`idp-int-${suffix}`),
          password: `a sufficiently long passphrase ${suffix}`,
          organizationName: `Idp Int ${suffix}`,
          organizationSlug: testSlug(`idp-int-${suffix}`),
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(201);
      createdUserIds.add(response.body.user.id as string);
      createdOrgIds.add(response.body.organization.id as string);
      return response.body.organization.id as string;
    }

    function bindInput(
      organizationId: string,
      overrides: Partial<{
        scope: (typeof IDEMPOTENCY_SCOPES)[keyof typeof IDEMPOTENCY_SCOPES];
        keyHash: string;
        requestFingerprint: string;
        resourceType: (typeof IDEMPOTENCY_RESOURCE_TYPES)[keyof typeof IDEMPOTENCY_RESOURCE_TYPES];
        resourceId: string;
      }> = {},
    ) {
      return {
        organizationId,
        scope: IDEMPOTENCY_SCOPES.PAYMENT_CAPTURE,
        keyHash: hashIdempotencyKey(`key-${randomUUID()}`),
        requestFingerprint: hashIdempotencyKey(`fp-${randomUUID()}`),
        resourceType: IDEMPOTENCY_RESOURCE_TYPES.PAYMENT,
        resourceId: randomUUID(),
        ...overrides,
      };
    }

    async function attemptBind(input: ReturnType<typeof bindInput>) {
      try {
        return await db.$transaction(async (tx) => {
          const existing = await idempotency.resolveReplay(tx, input);
          if (existing !== undefined) {
            return existing;
          }
          return idempotency.bindCompleted(tx, input);
        });
      } catch (error) {
        if (isIdempotencyUnique(error)) {
          const replay = await idempotency.resolveReplay(db, input);
          if (replay !== undefined) {
            return replay;
          }
        }
        throw error;
      }
    }

    it('exposes unique (organizationId, scope, keyHash) and COMPLETED/IN_PROGRESS in PostgreSQL', async () => {
      const indexes = await db.$queryRaw<{ indexname: string }[]>`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'idempotency_records'
      `;
      const names = indexes.map((row) => row.indexname);
      expect(names).toContain('idempotency_records_org_scope_key_uidx');
      expect(names).toContain('idempotency_records_scope_resource_uidx');
      expect(names).toContain('idempotency_records_pkey');

      const statuses = await db.$queryRaw<{ enumlabel: string }[]>`
        SELECT e.enumlabel
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'idempotency_record_status'
        ORDER BY e.enumlabel
      `;
      expect(statuses.map((row) => row.enumlabel)).toEqual(['COMPLETED', 'IN_PROGRESS']);

      const migrated = await db.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS n
        FROM idempotency_records
        WHERE status <> 'COMPLETED'
      `;
      expect(Number(migrated[0]?.n ?? 1)).toBe(0);
    });

    it('resolves N concurrent same-fingerprint binds to one operation identity', async () => {
      const organizationId = await registerOrg();
      const input = bindInput(organizationId);
      const results = await Promise.all(Array.from({ length: 10 }, () => attemptBind(input)));
      const ids = new Set(results.map((row) => row.id));
      expect(ids.size).toBe(1);
      expect(results.every((row) => row.resourceId === results[0]?.resourceId)).toBe(true);
      const count = await db.idempotencyRecord.count({
        where: {
          organizationId,
          scope: input.scope,
          keyHash: input.keyHash,
        },
      });
      expect(count).toBe(1);
      expect(results[0]?.status).toBe(IdempotencyRecordStatus.COMPLETED);
    });

    it('conflicts when the same key is reused with a different fingerprint', async () => {
      const organizationId = await registerOrg();
      const keyHash = hashIdempotencyKey(`conflict-${randomUUID()}`);
      const winner = bindInput(organizationId, { keyHash });
      await attemptBind(winner);
      const loser = bindInput(organizationId, {
        keyHash,
        requestFingerprint: hashIdempotencyKey(`other-${randomUUID()}`),
      });
      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, () => attemptBind(loser)),
      );
      expect(outcomes.every((row) => row.status === 'rejected')).toBe(true);
      for (const row of outcomes) {
        expect(row.status).toBe('rejected');
        if (row.status === 'rejected') {
          expect(row.reason).toBeInstanceOf(IdempotencyKeyConflictException);
          expect((row.reason as Error).message).not.toMatch(/p2002|fingerprint|sha-?256/i);
        }
      }
    });

    it('isolates the same raw key across scopes and organizations', async () => {
      const orgA = await registerOrg();
      const orgB = await registerOrg();
      const keyHash = hashIdempotencyKey('shared-raw-key');
      const fingerprint = hashIdempotencyKey('shared-fp');
      const paymentCreate = await attemptBind(
        bindInput(orgA, {
          scope: IDEMPOTENCY_SCOPES.PAYMENT_CREATE,
          keyHash,
          requestFingerprint: fingerprint,
        }),
      );
      const refundCreate = await attemptBind(
        bindInput(orgA, {
          scope: IDEMPOTENCY_SCOPES.REFUND_CREATE,
          keyHash,
          requestFingerprint: fingerprint,
          resourceType: IDEMPOTENCY_RESOURCE_TYPES.REFUND,
        }),
      );
      const capture = await attemptBind(
        bindInput(orgA, {
          scope: IDEMPOTENCY_SCOPES.PAYMENT_CAPTURE,
          keyHash,
          requestFingerprint: fingerprint,
        }),
      );
      const otherOrg = await attemptBind(
        bindInput(orgB, {
          scope: IDEMPOTENCY_SCOPES.PAYMENT_CREATE,
          keyHash,
          requestFingerprint: fingerprint,
        }),
      );
      expect(new Set([paymentCreate.id, refundCreate.id, capture.id, otherOrg.id]).size).toBe(4);
    });

    it('returns IN_PROGRESS rather than a completed result, then completes', async () => {
      const organizationId = await registerOrg();
      const input = bindInput(organizationId);
      const reserved = await db.$transaction((tx) => idempotency.reserveInProgress(tx, input));
      expect(reserved.status).toBe(IdempotencyRecordStatus.IN_PROGRESS);
      await expect(idempotency.resolveReplay(db, input)).rejects.toBeInstanceOf(
        IdempotencyOperationInProgressException,
      );
      const completed = await idempotency.complete(db, {
        organizationId,
        operationId: reserved.id,
      });
      expect(completed.status).toBe(IdempotencyRecordStatus.COMPLETED);
      const replay = await idempotency.resolveReplay(db, input);
      expect(replay?.id).toBe(reserved.id);
    });

    it('rolls back the idempotency binding when the caller transaction fails', async () => {
      const organizationId = await registerOrg();
      const input = bindInput(organizationId);
      await expect(
        db.$transaction(async (tx) => {
          await idempotency.bindCompleted(tx, input);
          throw new Error('force rollback');
        }),
      ).rejects.toThrow(/force rollback/);
      expect(await idempotency.findExisting(db, input)).toBeNull();
    });

    it('replays existing payment.create and refund.create after the hardening migration', async () => {
      const organizationId = await registerOrg();
      const paymentKey = `pay-${randomUUID()}`;
      const created = await payments.create(
        {
          organizationId,
          amount: '10000',
          currency: 'USD',
          captureMethod: 'AUTOMATIC',
          idempotencyKey: paymentKey,
        },
        actor,
      );
      const replayedPayment = await payments.create(
        {
          organizationId,
          amount: '10000',
          currency: 'USD',
          captureMethod: 'AUTOMATIC',
          idempotencyKey: paymentKey,
        },
        actor,
      );
      expect(replayedPayment.id).toBe(created.id);

      const binding = await db.idempotencyRecord.findFirst({
        where: { organizationId, resourceId: created.id, scope: 'payment.create' },
      });
      expect(binding?.status).toBe(IdempotencyRecordStatus.COMPLETED);
      expect(binding?.id).toBeDefined();

      await payments.beginAuthorization(organizationId, created.id, actor);
      await payments.markAuthorized(organizationId, created.id, 10000n, actor);
      await payments.markSucceeded(organizationId, created.id, 10000n, actor);

      const refundKey = `ref-${randomUUID()}`;
      const refund = await refunds.create(
        {
          organizationId,
          paymentId: created.id,
          amount: '2500',
          idempotencyKey: refundKey,
        },
        actor,
      );
      const replayedRefund = await refunds.create(
        {
          organizationId,
          paymentId: created.id,
          amount: '2500',
          idempotencyKey: refundKey,
        },
        actor,
      );
      expect(replayedRefund.id).toBe(refund.id);
      const refundBinding = await db.idempotencyRecord.findFirst({
        where: { organizationId, resourceId: refund.id, scope: 'refund.create' },
      });
      expect(refundBinding?.status).toBe(IdempotencyRecordStatus.COMPLETED);
    });

    it('rejects unregistered scope strings at the database', async () => {
      const organizationId = await registerOrg();
      await expect(
        db.$executeRaw`
          INSERT INTO idempotency_records (
            id, organization_id, scope, key_hash, request_fingerprint,
            resource_type, resource_id, status, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${organizationId}::uuid, 'STRIPE.charge',
            ${'a'.repeat(64)}, ${'b'.repeat(64)},
            'payment', gen_random_uuid(), 'COMPLETED', NOW(), NOW()
          )
        `,
      ).rejects.toThrow(/idempotency_records_scope_shape/);
    });
  },
);
