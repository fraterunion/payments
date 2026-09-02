import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@fraterunion-payments/database';
import {
  InboxService,
  processStripeInboxEvent,
  RetryableEventError,
} from '@fraterunion-payments/events';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigService } from '../src/config/app-config.service';
import { DatabaseService } from '../src/database/database.service';
import { PaymentProviderExecutionService } from '../src/payments/payment-provider-execution.service';
import { PaymentsService } from '../src/payments/payments.service';
import { RefundProviderExecutionService } from '../src/refunds/refund-provider-execution.service';
import { RefundsService } from '../src/refunds/refunds.service';
import { StripeInboxProcessorService } from '../src/webhooks/stripe-inbox-processor.service';
import { deleteTenantsForTests, teardownRealPgSuite } from './support/immutable-audit-cleanup';
import {
  stripeFinancialEvent,
  stripePaymentIntentObject,
  stripeRefundObject,
} from './support/stripe-financial-event';
import {
  postStripeWebhook,
  signStripeWebhook,
  TEST_STRIPE_WEBHOOK_SECRET,
} from './support/stripe-webhook';
import { resolveDatabaseUrl } from './support/test-database-url';
import { createTestEnvironment } from './support/test-environment';
import { testEmail, testSlug } from './support/test-ownership';

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl === undefined) {
  console.warn(
    'Skipping Stripe webhook normalization suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)(
  'Stripe webhook normalization (real PostgreSQL)',
  () => {
    let app: NestExpressApplication;
    let db: PrismaClient;
    let payments: PaymentsService;
    let refunds: RefundsService;
    let paymentExecutions: PaymentProviderExecutionService;
    let refundExecutions: RefundProviderExecutionService;
    let processor: StripeInboxProcessorService;
    const inbox = new InboxService();
    const createdUserIds = new Set<string>();
    const createdOrgIds = new Set<string>();
    const actor = { type: 'SYSTEM' as const };

    beforeAll(async () => {
      if (databaseUrl === undefined) {
        throw new Error('DATABASE_URL must be set');
      }
      const environment = createTestEnvironment({
        databaseUrl,
        swaggerEnabled: false,
        stripeWebhookSecret: TEST_STRIPE_WEBHOOK_SECRET,
      });
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule.forRoot(environment)],
      }).compile();
      app = moduleRef.createNestApplication<NestExpressApplication>();
      configureApp(app, app.get(AppConfigService));
      await app.init();
      await app.listen(0);
      db = app.get(DatabaseService).getClient();
      payments = app.get(PaymentsService);
      refunds = app.get(RefundsService);
      paymentExecutions = app.get(PaymentProviderExecutionService);
      refundExecutions = app.get(RefundProviderExecutionService);
      processor = app.get(StripeInboxProcessorService);
      await deleteTenantsForTests(db);
    });

    afterAll(async () => {
      await db.inboxEvent.deleteMany({
        where: { source: 'stripe', externalEventId: { startsWith: 'evt_fup_norm_' } },
      });
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
          email: testEmail(`wh-norm-${suffix}`),
          password: `a sufficiently long passphrase ${suffix}`,
          organizationName: `Webhook Norm ${suffix}`,
          organizationSlug: testSlug(`wh-norm-${suffix}`),
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

    async function authorizingPayment(
      organizationId: string,
      captureMethod: 'AUTOMATIC' | 'MANUAL' = 'AUTOMATIC',
      amount = '10000',
    ) {
      const created = await payments.create(
        {
          organizationId,
          amount,
          currency: 'USD',
          captureMethod,
          idempotencyKey: `pay-${randomUUID()}`,
        },
        actor,
      );
      return payments.beginAuthorization(organizationId, created.id, actor);
    }

    async function capturedPayment(organizationId: string, amount = '10000') {
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
      return payments.markSucceeded(organizationId, created.id, BigInt(amount), actor);
    }

    async function bindPayment(
      organizationId: string,
      paymentId: string,
      providerPaymentId: string,
      providerAccountReference?: string,
    ) {
      return paymentExecutions.create(
        {
          organizationId,
          paymentId,
          provider: 'stripe',
          providerPaymentId,
          ...(providerAccountReference !== undefined ? { providerAccountReference } : {}),
        },
        actor,
      );
    }

    async function ingestAndClaim(event: Record<string, unknown>) {
      const payload = JSON.stringify(event);
      await postStripeWebhook(app.getHttpServer(), payload, signStripeWebhook(payload)).expect(200);
      const row = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: String(event['id']) },
      });
      return inbox.beginProcessing(db, row.id);
    }

    it('applied the provider financial executions migration', async () => {
      const rows = await db.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM _prisma_migrations
        WHERE migration_name = '20260902220000_add_provider_financial_executions'
      `;
      expect(rows).toHaveLength(1);
    });

    it('rejects cross-binding the same provider payment object to two Payments', async () => {
      const { organizationId } = await registerOrg();
      const first = await authorizingPayment(organizationId);
      const second = await authorizingPayment(organizationId);
      const providerPaymentId = `pi_bind_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, first.id, providerPaymentId);
      await expect(bindPayment(organizationId, second.id, providerPaymentId)).rejects.toMatchObject(
        { code: 'PROVIDER_EXECUTION_ALREADY_BOUND' },
      );
    });

    it('rejects cross-binding the same provider refund object', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const first = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '1000',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const second = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '1000',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const paymentExecution = await bindPayment(
        organizationId,
        payment.id,
        `pi_reuniq_${randomUUID().slice(0, 8)}`,
      );
      const providerRefundId = `re_uniq_${randomUUID().slice(0, 8)}`;
      await refundExecutions.create(
        {
          organizationId,
          refundId: first.id,
          paymentProviderExecutionId: paymentExecution.id,
          providerRefundId,
        },
        actor,
      );
      await expect(
        refundExecutions.create(
          {
            organizationId,
            refundId: second.id,
            paymentProviderExecutionId: paymentExecution.id,
            providerRefundId,
          },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_EXECUTION_ALREADY_BOUND' });
    });

    it('enforces payment execution tenant composite FK and account-scope CHECK', async () => {
      const a = await registerOrg();
      const b = await registerOrg();
      const payment = await authorizingPayment(a.organizationId);
      await expect(
        db.$executeRaw`
          INSERT INTO payment_provider_executions (
            id, organization_id, payment_id, provider,
            provider_account_scope, provider_payment_id, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${b.organizationId}::uuid, ${payment.id}::uuid,
            'stripe', 'default', ${`pi_fk_${randomUUID().slice(0, 8)}`}, NOW(), NOW()
          )
        `,
      ).rejects.toThrow(/payment_provider_executions_payment_org_fkey/);

      await expect(
        db.$executeRaw`
          INSERT INTO payment_provider_executions (
            id, organization_id, payment_id, provider, provider_account_reference,
            provider_account_scope, provider_payment_id, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${a.organizationId}::uuid, ${payment.id}::uuid,
            'stripe', 'acct_mismatch', 'default', ${`pi_scope_${randomUUID().slice(0, 8)}`},
            NOW(), NOW()
          )
        `,
      ).rejects.toThrow(/payment_provider_executions_account_scope_consistent/);
    });

    it('rejects a refund execution attached to another payment provider object', async () => {
      const { organizationId } = await registerOrg();
      const paymentA = await capturedPayment(organizationId);
      const paymentB = await capturedPayment(organizationId);
      const refund = await refunds.create(
        {
          organizationId,
          paymentId: paymentA.id,
          amount: '1000',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const executionB = await bindPayment(
        organizationId,
        paymentB.id,
        `pi_b_${randomUUID().slice(0, 8)}`,
      );
      await expect(
        refundExecutions.create(
          {
            organizationId,
            refundId: refund.id,
            paymentProviderExecutionId: executionB.id,
            providerRefundId: `re_${randomUUID().slice(0, 8)}`,
          },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_EXECUTION_PAYMENT_MISMATCH' });
    });

    it('fast-forwards automatic capture AUTHORIZING to SUCCEEDED', async () => {
      const { organizationId } = await registerOrg();
      const payment = await authorizingPayment(organizationId, 'AUTOMATIC');
      const pi = `pi_auto_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      const event = stripeFinancialEvent(
        'payment_intent.succeeded',
        stripePaymentIntentObject({ id: pi }),
        { id: `evt_fup_norm_auto_${randomUUID().slice(0, 8)}` },
      );
      const claimed = await ingestAndClaim(event);
      const result = await processor.process(claimed);
      expect(result.outcome).toBe('APPLIED');
      const updated = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe('SUCCEEDED');
      expect(updated.authorizedAmount).toBe(10000n);
      expect(updated.capturedAmount).toBe(10000n);
      expect(
        await db.auditLog.count({
          where: { organizationId, resourceId: payment.id, action: 'payment.succeeded' },
        }),
      ).toBe(1);
      expect(
        await db.outboxEvent.count({
          where: { organizationId, eventType: { startsWith: 'payment.' } },
        }),
      ).toBe(0);
    });

    it('authorizes a manual capture snapshot without capturing', async () => {
      const { organizationId } = await registerOrg();
      const payment = await authorizingPayment(organizationId, 'MANUAL');
      const pi = `pi_man_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      const event = stripeFinancialEvent(
        'payment_intent.amount_capturable_updated',
        stripePaymentIntentObject({
          id: pi,
          status: 'requires_capture',
          capture_method: 'manual',
          amount_capturable: 10000,
          amount_received: 0,
        }),
        { id: `evt_fup_norm_man_${randomUUID().slice(0, 8)}` },
      );
      await processor.process(await ingestAndClaim(event));
      const updated = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe('AUTHORIZED');
      expect(updated.authorizedAmount).toBe(10000n);
      expect(updated.capturedAmount).toBe(0n);
    });

    it('maps payment_failed requires_payment_method without terminal FAILED', async () => {
      const { organizationId } = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_rpm_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      const event = stripeFinancialEvent(
        'payment_intent.payment_failed',
        stripePaymentIntentObject({
          id: pi,
          status: 'requires_payment_method',
          amount_capturable: 0,
          amount_received: 0,
          last_payment_error: { code: 'card_declined', message: 'Declined', type: 'card_error' },
        }),
        { id: `evt_fup_norm_rpm_${randomUUID().slice(0, 8)}` },
      );
      await processor.process(await ingestAndClaim(event));
      const updated = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe('REQUIRES_PAYMENT_METHOD');
      expect(updated.failureCategory).toBeNull();
    });

    it('advances requires_action and cancels from AUTHORIZING', async () => {
      const { organizationId } = await registerOrg();
      const actionPayment = await authorizingPayment(organizationId);
      const cancelPayment = await authorizingPayment(organizationId);
      const piAction = `pi_act_${randomUUID().slice(0, 8)}`;
      const piCancel = `pi_can_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, actionPayment.id, piAction);
      await bindPayment(organizationId, cancelPayment.id, piCancel);
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'payment_intent.requires_action',
            stripePaymentIntentObject({
              id: piAction,
              status: 'requires_action',
              amount_capturable: 0,
              amount_received: 0,
              next_action: { type: 'use_stripe_sdk' },
            }),
            { id: `evt_fup_norm_act_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'payment_intent.canceled',
            stripePaymentIntentObject({
              id: piCancel,
              status: 'canceled',
              amount_capturable: 0,
              amount_received: 0,
            }),
            { id: `evt_fup_norm_can_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      expect((await db.payment.findUniqueOrThrow({ where: { id: actionPayment.id } })).status).toBe(
        'REQUIRES_ACTION',
      );
      expect((await db.payment.findUniqueOrThrow({ where: { id: cancelPayment.id } })).status).toBe(
        'CANCELED',
      );
    });

    it('keeps SUCCEEDED after stale processing and payment_failed snapshots', async () => {
      const { organizationId } = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_stale_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent('payment_intent.succeeded', stripePaymentIntentObject({ id: pi }), {
            id: `evt_fup_norm_stale_ok_${randomUUID().slice(0, 8)}`,
          }),
        ),
      );
      const processing = await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'payment_intent.processing',
            stripePaymentIntentObject({ id: pi, status: 'processing', amount_received: 0 }),
            { id: `evt_fup_norm_stale_proc_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      const failed = await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'payment_intent.payment_failed',
            stripePaymentIntentObject({
              id: pi,
              status: 'requires_payment_method',
              amount_received: 0,
              last_payment_error: { type: 'card_error', message: 'late' },
            }),
            { id: `evt_fup_norm_stale_fail_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      expect(processing.outcome).toBe('NOOP_STALE');
      expect(failed.outcome).toBe('NOOP_STALE');
      const updated = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe('SUCCEEDED');
      expect(
        await db.auditLog.count({
          where: { organizationId, resourceId: payment.id, action: 'payment.failed' },
        }),
      ).toBe(0);
    });

    it('fails malformed PaymentIntent object shape without mutating Payment', async () => {
      const { organizationId } = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_mal_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      await expect(
        processor.process(
          await ingestAndClaim(
            stripeFinancialEvent(
              'payment_intent.succeeded',
              {
                id: pi,
                object: 'charge',
                status: 'succeeded',
                amount: 10000,
                currency: 'usd',
                capture_method: 'automatic',
                amount_capturable: 0,
                amount_received: 10000,
              },
              { id: `evt_fup_norm_mal_${randomUUID().slice(0, 8)}` },
            ),
          ),
        ),
      ).rejects.toMatchObject({ code: 'MALFORMED_PROVIDER_OBJECT' });
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'AUTHORIZING',
      );
    });

    it('marks ignored event types PROCESSED without financial mutation', async () => {
      const { organizationId } = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const event = stripeFinancialEvent(
        'customer.updated',
        { id: 'cus_ignored', object: 'customer' },
        { id: `evt_fup_norm_ign_${randomUUID().slice(0, 8)}` },
      );
      const result = await processor.process(await ingestAndClaim(event));
      expect(result.outcome).toBe('IGNORED_EVENT_TYPE');
      expect(result.event.status).toBe('PROCESSED');
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'AUTHORIZING',
      );
    });

    it('defers unknown provider references and applies after execution binding', async () => {
      const { organizationId } = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_unk_${randomUUID().slice(0, 8)}`;
      const claimed = await ingestAndClaim(
        stripeFinancialEvent('payment_intent.succeeded', stripePaymentIntentObject({ id: pi }), {
          id: `evt_fup_norm_unk_${randomUUID().slice(0, 8)}`,
        }),
      );
      await expect(processor.process(claimed)).rejects.toMatchObject({
        code: 'UNRESOLVED_EXTERNAL_REFERENCE',
      });
      const retried = await inbox.markFailedOrRetry(
        db,
        claimed,
        new RetryableEventError('unresolved', 'UNRESOLVED_EXTERNAL_REFERENCE'),
        {
          retryPolicy: { maxAttempts: 10, baseDelayMs: 1, maxDelayMs: 1 },
          random: () => 0,
        },
      );
      expect(retried.status).toBe('RECEIVED');
      expect(retried.processingOutcome).toBe('UNRESOLVED_REFERENCE');
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'AUTHORIZING',
      );
      await bindPayment(organizationId, payment.id, pi);
      const again = await inbox.beginProcessing(db, retried.id);
      const applied = await processor.process(again);
      expect(applied.outcome).toBe('APPLIED');
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'SUCCEEDED',
      );
    });

    it('does not mutate on tenant or account mismatch', async () => {
      const a = await registerOrg();
      const b = await registerOrg();
      const payment = await authorizingPayment(b.organizationId);
      const accountA = `acct_mis_${randomUUID().slice(0, 8)}`;
      await db.providerAccountConnection.create({
        data: {
          organizationId: a.organizationId,
          provider: 'stripe',
          providerAccountId: accountA,
          status: 'ACTIVE',
          paymentsEnabled: true,
          payoutsEnabled: true,
          requirementsDue: false,
        },
      });
      const pi = `pi_mis_${randomUUID().slice(0, 8)}`;
      await bindPayment(b.organizationId, payment.id, pi, accountA);
      const claimed = await ingestAndClaim(
        stripeFinancialEvent('payment_intent.succeeded', stripePaymentIntentObject({ id: pi }), {
          id: `evt_fup_norm_mis_${randomUUID().slice(0, 8)}`,
          account: accountA,
        }),
      );
      expect(claimed.organizationId).toBe(a.organizationId);
      await expect(processor.process(claimed)).rejects.toMatchObject({
        code: 'PROVIDER_EXECUTION_ACCOUNT_MISMATCH',
      });
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'AUTHORIZING',
      );
      expect(
        await db.auditLog.count({
          where: { organizationId: b.organizationId, action: 'payment.succeeded' },
        }),
      ).toBe(0);
    });

    it('treats currency and amount contradictions as anomalies', async () => {
      const { organizationId } = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_amt_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      await expect(
        processor.process(
          await ingestAndClaim(
            stripeFinancialEvent(
              'payment_intent.succeeded',
              stripePaymentIntentObject({ id: pi, currency: 'eur' }),
              { id: `evt_fup_norm_cur_${randomUUID().slice(0, 8)}` },
            ),
          ),
        ),
      ).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
      await expect(
        processor.process(
          await ingestAndClaim(
            stripeFinancialEvent(
              'payment_intent.succeeded',
              stripePaymentIntentObject({
                id: pi,
                amount: 20000,
                amount_received: 20000,
              }),
              { id: `evt_fup_norm_over_${randomUUID().slice(0, 8)}` },
            ),
          ),
        ),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_EXCEEDS_REQUESTED' });
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'AUTHORIZING',
      );
    });

    it('applies a final partial capture according to adapter amount formulas', async () => {
      const { organizationId } = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_part_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'payment_intent.succeeded',
            stripePaymentIntentObject({
              id: pi,
              amount: 10000,
              amount_capturable: 0,
              amount_received: 6000,
            }),
            { id: `evt_fup_norm_part_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      const updated = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe('SUCCEEDED');
      expect(updated.authorizedAmount).toBe(6000n);
      expect(updated.capturedAmount).toBe(6000n);
    });

    it('increments refundedAmount exactly once for duplicate succeeded refund snapshots', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const refund = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '4000',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const pi = `pi_re_${randomUUID().slice(0, 8)}`;
      const re = `re_${randomUUID().slice(0, 8)}`;
      const paymentExecution = await bindPayment(organizationId, payment.id, pi);
      await refundExecutions.create(
        {
          organizationId,
          refundId: refund.id,
          paymentProviderExecutionId: paymentExecution.id,
          providerRefundId: re,
        },
        actor,
      );
      const first = await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'refund.created',
            stripeRefundObject({ id: re, payment_intent: pi, amount: 4000 }),
            { id: `evt_fup_norm_re_a_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      const second = await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'refund.updated',
            stripeRefundObject({ id: re, payment_intent: pi, amount: 4000 }),
            { id: `evt_fup_norm_re_b_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      expect(first.outcome).toBe('APPLIED');
      expect(second.outcome).toBe('NOOP_ALREADY_CURRENT');
      const updated = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.refundedAmount).toBe(4000n);
      expect(updated.status).toBe('PARTIALLY_REFUNDED');
      expect(
        await db.auditLog.count({
          where: { organizationId, resourceId: refund.id, action: 'refund.succeeded' },
        }),
      ).toBe(1);
    });

    it('does not regress a succeeded refund or release realized capacity', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const refund = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '4000',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const pi = `pi_rf_${randomUUID().slice(0, 8)}`;
      const re = `re_${randomUUID().slice(0, 8)}`;
      const paymentExecution = await bindPayment(organizationId, payment.id, pi);
      await refundExecutions.create(
        {
          organizationId,
          refundId: refund.id,
          paymentProviderExecutionId: paymentExecution.id,
          providerRefundId: re,
        },
        actor,
      );
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'refund.updated',
            stripeRefundObject({ id: re, payment_intent: pi, amount: 4000 }),
            { id: `evt_fup_norm_rf_ok_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      const stale = await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'refund.failed',
            stripeRefundObject({
              id: re,
              payment_intent: pi,
              amount: 4000,
              status: 'failed',
              failure_reason: 'expired_or_canceled_card',
            }),
            { id: `evt_fup_norm_rf_fail_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      expect(stale.outcome).toBe('NOOP_STALE');
      const updatedRefund = await db.refund.findUniqueOrThrow({ where: { id: refund.id } });
      const updatedPayment = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updatedRefund.status).toBe('SUCCEEDED');
      expect(updatedPayment.refundedAmount).toBe(4000n);
    });

    it('releases reservation when a processing refund fails', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const refund = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '3000',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const pi = `pi_failre_${randomUUID().slice(0, 8)}`;
      const re = `re_${randomUUID().slice(0, 8)}`;
      const paymentExecution = await bindPayment(organizationId, payment.id, pi);
      await refundExecutions.create(
        {
          organizationId,
          refundId: refund.id,
          paymentProviderExecutionId: paymentExecution.id,
          providerRefundId: re,
        },
        actor,
      );
      expect(
        (await refunds.getRefundCapacity(organizationId, payment.id)).reservedRefundAmount,
      ).toBe(3000n);
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'refund.failed',
            stripeRefundObject({
              id: re,
              payment_intent: pi,
              amount: 3000,
              status: 'failed',
              failure_reason: 'expired_or_canceled_card',
            }),
            { id: `evt_fup_norm_rel_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      expect((await db.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe(
        'FAILED',
      );
      expect(
        (await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).refundedAmount,
      ).toBe(0n);
      expect(
        (await refunds.getRefundCapacity(organizationId, payment.id)).reservedRefundAmount,
      ).toBe(0n);
    });

    it('serializes two workers on the same InboxEvent into one apply', async () => {
      const { organizationId } = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_two_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      const claimed = await ingestAndClaim(
        stripeFinancialEvent('payment_intent.succeeded', stripePaymentIntentObject({ id: pi }), {
          id: `evt_fup_norm_two_${randomUUID().slice(0, 8)}`,
        }),
      );
      const results = await Promise.all([processor.process(claimed), processor.process(claimed)]);
      const outcomes = results.map((result) => result.outcome).sort();
      expect(outcomes).toContain('APPLIED');
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'SUCCEEDED',
      );
      expect(
        await db.auditLog.count({
          where: { organizationId, resourceId: payment.id, action: 'payment.succeeded' },
        }),
      ).toBe(1);
    });

    it('converges concurrent capturable and succeeded events without deadlock', async () => {
      const { organizationId } = await registerOrg();
      const payment = await authorizingPayment(organizationId, 'MANUAL');
      const pi = `pi_conc_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      const capturable = await ingestAndClaim(
        stripeFinancialEvent(
          'payment_intent.amount_capturable_updated',
          stripePaymentIntentObject({
            id: pi,
            status: 'requires_capture',
            capture_method: 'manual',
            amount_capturable: 10000,
            amount_received: 0,
          }),
          { id: `evt_fup_norm_conc_a_${randomUUID().slice(0, 8)}` },
        ),
      );
      const succeeded = await ingestAndClaim(
        stripeFinancialEvent(
          'payment_intent.succeeded',
          stripePaymentIntentObject({
            id: pi,
            capture_method: 'manual',
            amount_capturable: 0,
            amount_received: 10000,
          }),
          { id: `evt_fup_norm_conc_b_${randomUUID().slice(0, 8)}` },
        ),
      );
      await Promise.all([processor.process(capturable), processor.process(succeeded)]);
      const updated = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe('SUCCEEDED');
      expect(updated.capturedAmount).toBe(10000n);
    });

    it('applies two concurrent refunds without losing captured capacity', async () => {
      const { organizationId } = await registerOrg();
      const payment = await capturedPayment(organizationId);
      const first = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '6000',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const second = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '4000',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const pi = `pi_rr_${randomUUID().slice(0, 8)}`;
      const paymentExecution = await bindPayment(organizationId, payment.id, pi);
      await refundExecutions.create(
        {
          organizationId,
          refundId: first.id,
          paymentProviderExecutionId: paymentExecution.id,
          providerRefundId: `re_a_${randomUUID().slice(0, 8)}`,
        },
        actor,
      );
      await refundExecutions.create(
        {
          organizationId,
          refundId: second.id,
          paymentProviderExecutionId: paymentExecution.id,
          providerRefundId: `re_b_${randomUUID().slice(0, 8)}`,
        },
        actor,
      );
      const firstExecution = await db.refundProviderExecution.findFirstOrThrow({
        where: { refundId: first.id },
      });
      const secondExecution = await db.refundProviderExecution.findFirstOrThrow({
        where: { refundId: second.id },
      });
      const firstEvent = await ingestAndClaim(
        stripeFinancialEvent(
          'refund.updated',
          stripeRefundObject({
            id: firstExecution.providerRefundId,
            payment_intent: pi,
            amount: 6000,
          }),
          { id: `evt_fup_norm_rr_a_${randomUUID().slice(0, 8)}` },
        ),
      );
      const secondEvent = await ingestAndClaim(
        stripeFinancialEvent(
          'refund.updated',
          stripeRefundObject({
            id: secondExecution.providerRefundId,
            payment_intent: pi,
            amount: 4000,
          }),
          { id: `evt_fup_norm_rr_b_${randomUUID().slice(0, 8)}` },
        ),
      );
      await Promise.all([processor.process(firstEvent), processor.process(secondEvent)]);
      const updated = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.refundedAmount).toBe(10000n);
      expect(updated.status).toBe('REFUNDED');
    });

    it('rolls back Payment and Inbox when audit write fails', async () => {
      const { organizationId } = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_aud_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      const claimed = await ingestAndClaim(
        stripeFinancialEvent('payment_intent.succeeded', stripePaymentIntentObject({ id: pi }), {
          id: `evt_fup_norm_aud_${randomUUID().slice(0, 8)}`,
        }),
      );
      await expect(
        processStripeInboxEvent(db, claimed, {
          writeAudit: async () => {
            throw new Error('audit rejected');
          },
        }),
      ).rejects.toThrow(/audit rejected/);
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'AUTHORIZING',
      );
      expect((await db.inboxEvent.findUniqueOrThrow({ where: { id: claimed.id } })).status).toBe(
        'PROCESSING',
      );
      const retry = await processor.process(claimed);
      expect(retry.outcome).toBe('APPLIED');
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'SUCCEEDED',
      );
    });

    it('does not create ledger tables while applying provider observations', async () => {
      const tables = await db.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('ledger_entries', 'ledger_accounts', 'journal_entries')
      `;
      expect(tables).toEqual([]);
    });
  },
);
