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
import { DatabaseService } from '../src/database/database.service';
import { PaymentsService } from '../src/payments/payments.service';
import { RefundsService } from '../src/refunds/refunds.service';
import { deleteTenantsForTests, teardownRealPgSuite } from './support/immutable-audit-cleanup';
import { resolveDatabaseUrl } from './support/test-database-url';
import { createTestEnvironment } from './support/test-environment';
import { testEmail, testSlug } from './support/test-ownership';

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl === undefined) {
  console.warn(
    'Skipping refund integration suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)(
  'Refunds integration (real PostgreSQL)',
  () => {
    let app: NestExpressApplication;
    let db: PrismaClient;
    let payments: PaymentsService;
    let refunds: RefundsService;
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
      refunds = app.get(RefundsService);
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
          email: testEmail(`ref-int-${suffix}`),
          password: `a sufficiently long passphrase ${suffix}`,
          organizationName: `Ref Int ${suffix}`,
          organizationSlug: testSlug(`ref-int-${suffix}`),
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

    async function capturedPayment(
      organizationId: string,
      amount = '10000',
    ): Promise<{ id: string; capturedAmount: bigint }> {
      const created = await payments.create(
        {
          organizationId,
          amount,
          currency: 'USD',
          captureMethod: 'AUTOMATIC',
          idempotencyKey: `pay-${randomUUID()}`,
        },
        actor,
      );
      await payments.beginAuthorization(organizationId, created.id, actor);
      await payments.markAuthorized(organizationId, created.id, BigInt(amount), actor);
      const succeeded = await payments.markSucceeded(
        organizationId,
        created.id,
        BigInt(amount),
        actor,
      );
      return { id: succeeded.id, capturedAmount: succeeded.capturedAmount };
    }

    function refundInput(
      organizationId: string,
      paymentId: string,
      overrides: Record<string, unknown> = {},
    ): Parameters<RefundsService['create']>[0] {
      return {
        organizationId,
        paymentId,
        amount: '3000',
        idempotencyKey: `ref-${randomUUID()}`,
        ...overrides,
      };
    }

    it('enforces refund amount CHECK constraints', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      await expect(
        db.$executeRaw`
          INSERT INTO refunds (
            id, organization_id, payment_id, status, currency, amount,
            metadata, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${organizationId}::uuid, ${payment.id}::uuid,
            'CREATED', 'USD', 0, '{}'::jsonb, NOW(), NOW()
          )
        `,
      ).rejects.toThrow(/refunds_amount_positive/);

      await expect(
        db.$executeRaw`
          INSERT INTO refunds (
            id, organization_id, payment_id, status, currency, amount,
            metadata, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${organizationId}::uuid, ${payment.id}::uuid,
            'CREATED', 'usd', 100, '{}'::jsonb, NOW(), NOW()
          )
        `,
      ).rejects.toThrow(/refunds_currency_iso_shape/);
    });

    it('enforces the payment/refund composite tenant FK', async () => {
      const a = await registerOrg();
      const b = await registerOrg();
      const foreign = await capturedPayment(b.organizationId);
      await expect(
        refunds.create(refundInput(a.organizationId, foreign.id), actor),
      ).rejects.toMatchObject({ code: 'REFUND_PAYMENT_NOT_FOUND' });
    });

    it('rejects refunds against non-refundable payments', async () => {
      const { organizationId } = await registerOrg();
      const created = await payments.create(
        {
          organizationId,
          amount: '10000',
          currency: 'USD',
          captureMethod: 'MANUAL',
          idempotencyKey: `created-${randomUUID()}`,
        },
        actor,
      );
      await expect(
        refunds.create(refundInput(organizationId, created.id), actor),
      ).rejects.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });

      await payments.beginAuthorization(organizationId, created.id, actor);
      await payments.markAuthorized(organizationId, created.id, 10000n, actor);
      await expect(
        refunds.create(refundInput(organizationId, created.id), actor),
      ).rejects.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });
    });

    it('counts pending reservations against captured funds, not only succeeded refunds', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      await refunds.create(refundInput(organizationId, payment.id, { amount: '3000' }), actor);
      const stillZero = await payments.get(organizationId, payment.id);
      expect(stillZero.refundedAmount).toBe(0n);
      expect(stillZero.status).toBe('SUCCEEDED');

      const capacity = await refunds.getRefundCapacity(organizationId, payment.id);
      expect(capacity.reservedRefundAmount).toBe(3000n);
      expect(capacity.availableRefundAmount).toBe(7000n);

      await expect(
        refunds.create(refundInput(organizationId, payment.id, { amount: '8000' }), actor),
      ).rejects.toMatchObject({ code: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE' });
    });

    it('accepts only one of concurrent 7000+7000 reservations against 10000', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const raced = await Promise.allSettled([
        refunds.create(refundInput(organizationId, payment.id, { amount: '7000' }), actor),
        refunds.create(refundInput(organizationId, payment.id, { amount: '7000' }), actor),
      ]);
      const fulfilled = raced.filter((r) => r.status === 'fulfilled');
      const rejected = raced.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
      });
      expect(await db.refund.count({ where: { organizationId, paymentId: payment.id } })).toBe(1);
      const capacity = await refunds.getRefundCapacity(organizationId, payment.id);
      expect(capacity.reservedRefundAmount).toBe(7000n);
    });

    it('creates exactly one refund for concurrent same-key requests', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const input = refundInput(organizationId, payment.id, {
        amount: '4000',
        idempotencyKey: 'same-refund-key',
      });
      const results = await Promise.allSettled([
        refunds.create(input, actor),
        refunds.create(input, actor),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(2);
      const first = (fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value;
      const second = (fulfilled[1] as PromiseFulfilledResult<{ id: string }>).value;
      expect(first.id).toBe(second.id);
      expect(await db.refund.count({ where: { organizationId, paymentId: payment.id } })).toBe(1);
    });

    it('conflicts when the same key is reused with a different payload', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const created = await refunds.create(
        refundInput(organizationId, payment.id, {
          amount: '3000',
          idempotencyKey: 'conflict-key',
        }),
        actor,
      );
      await expect(
        refunds.create(
          refundInput(organizationId, payment.id, {
            amount: '4000',
            idempotencyKey: 'conflict-key',
          }),
          actor,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
      expect(await db.refund.count({ where: { organizationId, paymentId: payment.id } })).toBe(1);
      expect((await refunds.get(organizationId, created.id)).amount).toBe(3000n);
    });

    it('replays an identical key even after later reservations consume remaining capacity', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const first = await refunds.create(
        refundInput(organizationId, payment.id, {
          amount: '5000',
          idempotencyKey: 'replay-after-capacity',
        }),
        actor,
      );
      await refunds.create(refundInput(organizationId, payment.id, { amount: '5000' }), actor);
      const replayed = await refunds.create(
        refundInput(organizationId, payment.id, {
          amount: '5000',
          idempotencyKey: 'replay-after-capacity',
        }),
        actor,
      );
      expect(replayed.id).toBe(first.id);
    });

    it('releases reserved capacity when a refund fails', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const pending = await refunds.create(
        refundInput(organizationId, payment.id, { amount: '7000' }),
        actor,
      );
      expect(
        (await refunds.getRefundCapacity(organizationId, payment.id)).availableRefundAmount,
      ).toBe(3000n);
      await refunds.beginRefundProcessing(organizationId, pending.id, actor);
      await refunds.failRefund(
        organizationId,
        pending.id,
        { category: 'PROVIDER', message: 'Issuer unavailable', retryable: true, code: 'timeout' },
        actor,
      );
      const failed = await refunds.get(organizationId, pending.id);
      expect(failed.status).toBe('FAILED');
      expect(failed.failureCategory).toBe('PROVIDER');
      const paymentAfter = await payments.get(organizationId, payment.id);
      expect(paymentAfter.refundedAmount).toBe(0n);
      expect(paymentAfter.status).toBe('SUCCEEDED');
      expect(
        (await refunds.getRefundCapacity(organizationId, payment.id)).availableRefundAmount,
      ).toBe(10000n);
      const replacement = await refunds.create(
        refundInput(organizationId, payment.id, { amount: '10000' }),
        actor,
      );
      expect(replacement.amount).toBe(10000n);
    });

    it('applies concurrent refund successes without losing payment projection updates', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const a = await refunds.create(
        refundInput(organizationId, payment.id, { amount: '6000' }),
        actor,
      );
      const b = await refunds.create(
        refundInput(organizationId, payment.id, { amount: '4000' }),
        actor,
      );
      await refunds.beginRefundProcessing(organizationId, a.id, actor);
      await refunds.beginRefundProcessing(organizationId, b.id, actor);
      const raced = await Promise.allSettled([
        refunds.succeedRefund(organizationId, a.id, actor),
        refunds.succeedRefund(organizationId, b.id, actor),
      ]);
      expect(raced.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      const final = await payments.get(organizationId, payment.id);
      expect(final.refundedAmount).toBe(10000n);
      expect(final.status).toBe('REFUNDED');
    });

    it('moves the payment from SUCCEEDED to PARTIALLY_REFUNDED then REFUNDED', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const first = await refunds.create(
        refundInput(organizationId, payment.id, { amount: '3000' }),
        actor,
      );
      await refunds.beginRefundProcessing(organizationId, first.id, actor);
      await refunds.succeedRefund(organizationId, first.id, actor);
      const partial = await payments.get(organizationId, payment.id);
      expect(partial.status).toBe('PARTIALLY_REFUNDED');
      expect(partial.refundedAmount).toBe(3000n);

      const second = await refunds.create(
        refundInput(organizationId, payment.id, { amount: '7000' }),
        actor,
      );
      await refunds.beginRefundProcessing(organizationId, second.id, actor);
      await refunds.succeedRefund(organizationId, second.id, actor);
      const fully = await payments.get(organizationId, payment.id);
      expect(fully.status).toBe('REFUNDED');
      expect(fully.refundedAmount).toBe(10000n);

      await expect(
        refunds.create(refundInput(organizationId, payment.id, { amount: '1' }), actor),
      ).rejects.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });

      const paymentAudit = await db.auditLog.findMany({
        where: {
          organizationId,
          action: { in: ['payment.partially_refunded', 'payment.refunded'] },
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(paymentAudit.map((row) => row.action)).toEqual([
        'payment.partially_refunded',
        'payment.refunded',
      ]);
    });

    it('rolls back refund and idempotency rows when audit is rejected', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const keyHash = 'c'.repeat(64);
      const fingerprint = 'd'.repeat(64);
      await expect(
        db.$transaction(async (tx) => {
          const created = await tx.refund.create({
            data: {
              organizationId,
              paymentId: payment.id,
              status: 'CREATED',
              currency: 'USD',
              amount: 1000n,
            },
          });
          await tx.idempotencyRecord.create({
            data: {
              organizationId,
              scope: 'refund.create',
              keyHash,
              requestFingerprint: fingerprint,
              resourceType: 'refund',
              resourceId: created.id,
            },
          });
          await audit.write(tx, {
            organizationId,
            actor,
            action: AUDIT_ACTIONS.REFUND_CREATED,
            resource: { type: AUDIT_RESOURCE_TYPES.REFUND, id: created.id },
            metadata: { password: 'nope' },
          });
        }),
      ).rejects.toThrow(/forbidden/);
      expect(await db.refund.count({ where: { organizationId } })).toBe(0);
      expect(
        await db.idempotencyRecord.count({
          where: { organizationId, scope: 'refund.create' },
        }),
      ).toBe(0);
    });

    it('restricts physical deletion of organizations and payments that own refunds', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      await refunds.create(refundInput(organizationId, payment.id), actor);
      await expect(db.payment.delete({ where: { id: payment.id } })).rejects.toThrow();
      await expect(db.organization.delete({ where: { id: organizationId } })).rejects.toThrow();
    });

    it('does not enqueue refund or payment-refund outbox events', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const created = await refunds.create(
        refundInput(organizationId, payment.id, { amount: '10000' }),
        actor,
      );
      await refunds.beginRefundProcessing(organizationId, created.id, actor);
      await refunds.succeedRefund(organizationId, created.id, actor);
      const financial = await db.outboxEvent.findMany({
        where: {
          organizationId,
          OR: [{ eventType: { startsWith: 'refund.' } }, { eventType: { startsWith: 'payment.' } }],
        },
      });
      expect(financial).toHaveLength(0);
    });

    it('preserves payment-create idempotency replay on the generalized table', async () => {
      const { organizationId } = await registerOrg();
      const created = await payments.create(
        {
          organizationId,
          amount: '12500',
          currency: 'USD',
          captureMethod: 'AUTOMATIC',
          idempotencyKey: 'legacy-shape-key',
        },
        actor,
      );
      const replay = await payments.create(
        {
          organizationId,
          amount: '12500',
          currency: 'USD',
          captureMethod: 'AUTOMATIC',
          idempotencyKey: 'legacy-shape-key',
        },
        actor,
      );
      expect(replay.id).toBe(created.id);
      const records = await db.idempotencyRecord.findMany({
        where: { organizationId, scope: 'payment.create', resourceId: created.id },
      });
      expect(records).toHaveLength(1);
    });
  },
);
