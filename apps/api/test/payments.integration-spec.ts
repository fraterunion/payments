import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@fraterunion-payments/database';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AuditService } from '../src/audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from '../src/audit/audit.types';
import { AppConfigService } from '../src/config/app-config.service';
import { CustomersService } from '../src/customers/customers.service';
import { DatabaseService } from '../src/database/database.service';
import { PaymentsService } from '../src/payments/payments.service';
import { deleteTenantsForTests, teardownRealPgSuite } from './support/immutable-audit-cleanup';
import { resolveDatabaseUrl } from './support/test-database-url';
import { createTestEnvironment } from './support/test-environment';
import { testEmail, testSlug } from './support/test-ownership';

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl === undefined) {
  console.warn(
    'Skipping payment integration suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)(
  'Payments integration (real PostgreSQL)',
  () => {
    let app: NestExpressApplication;
    let db: PrismaClient;
    let payments: PaymentsService;
    let customers: CustomersService;
    let audit: AuditService;

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
      payments = app.get(PaymentsService);
      customers = app.get(CustomersService);
      audit = app.get(AuditService);
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

    async function registerOrg(): Promise<{ organizationId: string; userId: string }> {
      const suffix = randomUUID().slice(0, 8);
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail(`pay-int-${suffix}`),
          password: `a sufficiently long passphrase ${suffix}`,
          organizationName: `Pay Int ${suffix}`,
          organizationSlug: testSlug(`pay-int-${suffix}`),
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(201);
      createdUserIds.add(response.body.user.id as string);
      createdOrgIds.add(response.body.organization.id as string);
      return {
        organizationId: response.body.organization.id as string,
        userId: response.body.user.id as string,
      };
    }

    function createInput(
      organizationId: string,
      overrides: Record<string, unknown> = {},
    ): Parameters<PaymentsService['create']>[0] {
      return {
        organizationId,
        amount: '12500',
        currency: 'USD',
        captureMethod: 'MANUAL',
        idempotencyKey: `key-${randomUUID()}`,
        ...overrides,
      };
    }

    it('enforces monetary CHECK constraints', async () => {
      const { organizationId } = await registerOrg();
      await expect(
        db.$executeRaw`
          INSERT INTO payments (
            id, organization_id, status, capture_method, currency,
            requested_amount, authorized_amount, captured_amount, refunded_amount,
            metadata, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${organizationId}::uuid, 'CREATED', 'MANUAL', 'USD',
            0, 0, 0, 0, '{}'::jsonb, NOW(), NOW()
          )
        `,
      ).rejects.toThrow(/payments_requested_amount_positive/);

      await expect(
        db.$executeRaw`
          INSERT INTO payments (
            id, organization_id, status, capture_method, currency,
            requested_amount, authorized_amount, captured_amount, refunded_amount,
            metadata, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${organizationId}::uuid, 'CREATED', 'MANUAL', 'usd',
            100, 0, 0, 0, '{}'::jsonb, NOW(), NOW()
          )
        `,
      ).rejects.toThrow(/payments_currency_iso_shape/);

      await expect(
        db.$executeRaw`
          INSERT INTO payments (
            id, organization_id, status, capture_method, currency,
            requested_amount, authorized_amount, captured_amount, refunded_amount,
            metadata, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${organizationId}::uuid, 'CREATED', 'MANUAL', 'USD',
            100, 200, 0, 0, '{}'::jsonb, NOW(), NOW()
          )
        `,
      ).rejects.toThrow(/payments_authorized_lte_requested/);

      await expect(
        db.$executeRaw`
          INSERT INTO payments (
            id, organization_id, status, capture_method, currency,
            requested_amount, authorized_amount, captured_amount, refunded_amount,
            metadata, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${organizationId}::uuid, 'SUCCEEDED', 'MANUAL', 'USD',
            100, 100, 0, 0, '{}'::jsonb, NOW(), NOW()
          )
        `,
      ).rejects.toThrow(/payments_succeeded_has_capture/);
    });

    it('enforces the customer tenant composite FK and rejects archived customers', async () => {
      const a = await registerOrg();
      const b = await registerOrg();
      const foreign = await customers.create(
        { organizationId: b.organizationId, name: 'Other' },
        actor,
      );
      await expect(
        payments.create(createInput(a.organizationId, { customerId: foreign.id }), actor),
      ).rejects.toMatchObject({ code: 'PAYMENT_CUSTOMER_NOT_FOUND' });

      const local = await customers.create(
        { organizationId: a.organizationId, name: 'Local' },
        actor,
      );
      await customers.archive(a.organizationId, local.id, actor);
      await expect(
        payments.create(createInput(a.organizationId, { customerId: local.id }), actor),
      ).rejects.toMatchObject({ code: 'PAYMENT_CUSTOMER_ARCHIVED' });

      const historical = await customers.create(
        { organizationId: a.organizationId, name: 'Before archive' },
        actor,
      );
      const payment = await payments.create(
        createInput(a.organizationId, { customerId: historical.id }),
        actor,
      );
      await customers.archive(a.organizationId, historical.id, actor);
      const readable = await payments.get(a.organizationId, payment.id);
      expect(readable.customerId).toBe(historical.id);
    });

    it('creates exactly one payment for concurrent same-key requests', async () => {
      const { organizationId } = await registerOrg();
      const input = createInput(organizationId, { idempotencyKey: 'same-key-race' });
      const results = await Promise.allSettled([
        payments.create(input, actor),
        payments.create(input, actor),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(2);
      const first = (fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value;
      const second = (fulfilled[1] as PromiseFulfilledResult<{ id: string }>).value;
      expect(first.id).toBe(second.id);
      expect(await db.payment.count({ where: { organizationId } })).toBe(1);
    });

    it('conflicts when the same key is reused with a different payload', async () => {
      const { organizationId } = await registerOrg();
      const created = await payments.create(
        createInput(organizationId, { idempotencyKey: 'conflict-key', amount: '12500' }),
        actor,
      );
      await expect(
        payments.create(
          createInput(organizationId, { idempotencyKey: 'conflict-key', amount: '15000' }),
          actor,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
      expect(await db.payment.count({ where: { organizationId } })).toBe(1);
      expect((await payments.get(organizationId, created.id)).requestedAmount).toBe(12500n);
    });

    it('persists each supported internal transition through payment-core', async () => {
      const { organizationId } = await registerOrg();

      const requiresMethod = await payments.create(createInput(organizationId), actor);
      const afterMethod = await payments.markRequiresPaymentMethod(
        organizationId,
        requiresMethod.id,
        actor,
      );
      expect(afterMethod.status).toBe('REQUIRES_PAYMENT_METHOD');

      const authorizing = await payments.create(createInput(organizationId), actor);
      const started = await payments.beginAuthorization(organizationId, authorizing.id, actor);
      expect(started.status).toBe('AUTHORIZING');

      const action = await payments.create(createInput(organizationId), actor);
      await payments.beginAuthorization(organizationId, action.id, actor);
      const requiresAction = await payments.markRequiresAction(organizationId, action.id, actor);
      expect(requiresAction.status).toBe('REQUIRES_ACTION');
      const resumed = await payments.resumeAuthorization(organizationId, action.id, actor);
      expect(resumed.status).toBe('AUTHORIZING');

      const manual = await payments.create(createInput(organizationId), actor);
      await payments.beginAuthorization(organizationId, manual.id, actor);
      const authorized = await payments.markAuthorized(organizationId, manual.id, 12500n, actor);
      expect(authorized.status).toBe('AUTHORIZED');
      expect(authorized.authorizedAmount).toBe(12500n);

      const automatic = await payments.create(
        createInput(organizationId, { captureMethod: 'AUTOMATIC' }),
        actor,
      );
      await payments.beginAuthorization(organizationId, automatic.id, actor);
      const capturingAuto = await payments.markAuthorized(
        organizationId,
        automatic.id,
        12500n,
        actor,
      );
      expect(capturingAuto.status).toBe('CAPTURING');

      const capture = await payments.create(createInput(organizationId), actor);
      await payments.beginAuthorization(organizationId, capture.id, actor);
      await payments.markAuthorized(organizationId, capture.id, 12500n, actor);
      const capturing = await payments.beginCapture(organizationId, capture.id, actor);
      expect(capturing.status).toBe('CAPTURING');
      const succeeded = await payments.markSucceeded(organizationId, capture.id, 12500n, actor);
      expect(succeeded.status).toBe('SUCCEEDED');
      expect(succeeded.capturedAmount).toBe(12500n);

      const canceled = await payments.create(createInput(organizationId), actor);
      await payments.beginAuthorization(organizationId, canceled.id, actor);
      await payments.markAuthorized(organizationId, canceled.id, 12500n, actor);
      const voided = await payments.cancelPayment(organizationId, canceled.id, actor);
      expect(voided.status).toBe('CANCELED');

      const failed = await payments.create(createInput(organizationId), actor);
      await payments.beginAuthorization(organizationId, failed.id, actor);
      const declined = await payments.markFailed(
        organizationId,
        failed.id,
        { category: 'DECLINED', message: 'Insufficient funds', retryable: false, code: 'nsf' },
        actor,
      );
      expect(declined.status).toBe('FAILED');
      expect(declined.failureCategory).toBe('DECLINED');
      expect(declined.failureMessage).toBe('Insufficient funds');
    });

    it('allows only one of concurrent beginCapture and cancelPayment to commit', async () => {
      const { organizationId } = await registerOrg();
      const payment = await payments.create(createInput(organizationId), actor);
      await payments.beginAuthorization(organizationId, payment.id, actor);
      await payments.markAuthorized(organizationId, payment.id, 12500n, actor);

      const raced = await Promise.allSettled([
        payments.beginCapture(organizationId, payment.id, actor),
        payments.cancelPayment(organizationId, payment.id, actor),
      ]);
      const fulfilled = raced.filter((r) => r.status === 'fulfilled');
      const rejected = raced.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'PAYMENT_INVALID_TRANSITION',
      });
      const final = await payments.get(organizationId, payment.id);
      expect(['CAPTURING', 'CANCELED']).toContain(final.status);
    });

    it('rolls back payment and idempotency rows when audit is rejected', async () => {
      const { organizationId } = await registerOrg();
      const keyHash = 'a'.repeat(64);
      const fingerprint = 'b'.repeat(64);
      await expect(
        db.$transaction(async (tx) => {
          const created = await tx.payment.create({
            data: {
              organizationId,
              status: 'CREATED',
              captureMethod: 'MANUAL',
              currency: 'USD',
              requestedAmount: 1000n,
            },
          });
          await tx.idempotencyRecord.create({
            data: {
              organizationId,
              scope: 'payment.create',
              keyHash,
              requestFingerprint: fingerprint,
              resourceType: 'payment',
              resourceId: created.id,
            },
          });
          await audit.write(tx, {
            organizationId,
            actor,
            action: AUDIT_ACTIONS.PAYMENT_CREATED,
            resource: { type: AUDIT_RESOURCE_TYPES.PAYMENT, id: created.id },
            metadata: { password: 'nope' },
          });
        }),
      ).rejects.toThrow(/forbidden/);
      expect(await db.payment.count({ where: { organizationId } })).toBe(0);
      expect(await db.idempotencyRecord.count({ where: { organizationId } })).toBe(0);
    });

    it('does not enqueue payment outbox events', async () => {
      const { organizationId } = await registerOrg();
      const created = await payments.create(createInput(organizationId), actor);
      await payments.beginAuthorization(organizationId, created.id, actor);
      await payments.markAuthorized(organizationId, created.id, 12500n, actor);
      await payments.beginCapture(organizationId, created.id, actor);
      await payments.markSucceeded(organizationId, created.id, 12500n, actor);
      const events = await db.outboxEvent.findMany({
        where: { organizationId, eventType: { startsWith: 'payment.' } },
      });
      expect(events).toHaveLength(0);
    });

    it('restricts physical deletion of organizations and customers that own payments', async () => {
      const { organizationId } = await registerOrg();
      const customer = await customers.create({ organizationId, name: 'Pinned payer' }, actor);
      await payments.create(createInput(organizationId, { customerId: customer.id }), actor);
      await expect(db.customer.delete({ where: { id: customer.id } })).rejects.toThrow();
      await expect(db.organization.delete({ where: { id: organizationId } })).rejects.toThrow();
    });

    it('records safe audit metadata and never a public lifecycle assignment', async () => {
      const { organizationId } = await registerOrg();
      const created = await payments.create(
        createInput(organizationId, { description: 'Dues', metadata: { plan: 'gold' } }),
        actor,
      );
      const row = await db.auditLog.findFirstOrThrow({
        where: { organizationId, action: 'payment.created', resourceId: created.id },
      });
      const metadata = row.metadata as Record<string, unknown>;
      expect(metadata['paymentId']).toBe(created.id);
      expect(metadata['status']).toBe('CREATED');
      expect(metadata['requestedAmount']).toBe('12500');
      expect(JSON.stringify(metadata)).not.toContain('Dues');
      expect(JSON.stringify(metadata)).not.toContain('gold');
      expect(JSON.stringify(metadata)).not.toMatch(/stripe|payment_intent|pi_/i);
    });
  },
);
