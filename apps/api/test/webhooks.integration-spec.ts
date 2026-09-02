import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@fraterunion-payments/database';
import { hashPayload, PLATFORM_SCOPE_KEY } from '@fraterunion-payments/events';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigService } from '../src/config/app-config.service';
import { DatabaseService } from '../src/database/database.service';
import { PaymentsService } from '../src/payments/payments.service';
import { RefundsService } from '../src/refunds/refunds.service';
import { deleteTenantsForTests, teardownRealPgSuite } from './support/immutable-audit-cleanup';
import {
  postStripeWebhook,
  signStripeWebhook,
  stripeWebhookPayload,
  TEST_STRIPE_WEBHOOK_SECRET,
} from './support/stripe-webhook';
import { resolveDatabaseUrl } from './support/test-database-url';
import { createTestEnvironment } from './support/test-environment';
import { testEmail, testSlug } from './support/test-ownership';

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl === undefined) {
  console.warn(
    'Skipping Stripe webhook integration suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)(
  'Stripe webhooks integration (real PostgreSQL)',
  () => {
    let app: NestExpressApplication;
    let db: PrismaClient;
    let payments: PaymentsService;
    let refunds: RefundsService;
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
      await deleteTenantsForTests(db);
    });

    afterAll(async () => {
      await db.inboxEvent.deleteMany({
        where: { source: 'stripe', externalEventId: { startsWith: 'evt_fup_test_' } },
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
          email: testEmail(`wh-int-${suffix}`),
          password: `a sufficiently long passphrase ${suffix}`,
          organizationName: `Webhook Int ${suffix}`,
          organizationSlug: testSlug(`wh-int-${suffix}`),
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

    async function bindStripeAccount(
      organizationId: string,
      providerAccountId: string,
    ): Promise<string> {
      const connection = await db.providerAccountConnection.create({
        data: {
          organizationId,
          provider: 'stripe',
          providerAccountId,
          status: 'ACTIVE',
          paymentsEnabled: true,
          payoutsEnabled: true,
          requirementsDue: false,
        },
      });
      return connection.id;
    }

    it('deduplicates 10 concurrent identical signed deliveries into one inbox row', async () => {
      const eventId = `evt_fup_test_${randomUUID()}`;
      const payload = stripeWebhookPayload({ id: eventId });
      const signature = signStripeWebhook(payload);
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          postStripeWebhook(app.getHttpServer(), payload, signature),
        ),
      );

      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ received: true });
        expect(JSON.stringify(response.body)).not.toMatch(/P2002|Unique constraint/i);
      }
      expect(
        await db.inboxEvent.count({ where: { source: 'stripe', externalEventId: eventId } }),
      ).toBe(1);
    });

    it('does not overwrite the original payload on a concurrent-safe conflict', async () => {
      const eventId = `evt_fup_test_${randomUUID()}`;
      const first = stripeWebhookPayload({
        id: eventId,
        data: { object: { id: 'pi_original', object: 'payment_intent', status: 'succeeded' } },
      });
      const conflicting = stripeWebhookPayload({
        id: eventId,
        data: { object: { id: 'pi_conflict', object: 'payment_intent', status: 'canceled' } },
      });
      await postStripeWebhook(app.getHttpServer(), first, signStripeWebhook(first)).expect(200);
      await postStripeWebhook(
        app.getHttpServer(),
        conflicting,
        signStripeWebhook(conflicting),
      ).expect(200);

      const row = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: eventId },
      });
      expect(row.payload).toEqual(JSON.parse(first));
      expect(row.payloadHash).toBe(hashPayload(JSON.parse(first)));
      expect(row.payloadHash).not.toBe(hashPayload(JSON.parse(conflicting)));
    });

    it('resolves tenant mapping, platform scope, and unknown accounts', async () => {
      const { organizationId } = await registerOrg();
      const accountId = `acct_fup_test_${randomUUID().slice(0, 8)}`;
      await bindStripeAccount(organizationId, accountId);

      const tenantEventId = `evt_fup_test_${randomUUID()}`;
      const tenantPayload = stripeWebhookPayload({
        id: tenantEventId,
        account: accountId,
      });
      await postStripeWebhook(
        app.getHttpServer(),
        tenantPayload,
        signStripeWebhook(tenantPayload),
      ).expect(200);
      const tenantRow = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: tenantEventId },
      });
      expect(tenantRow.organizationId).toBe(organizationId);
      expect(tenantRow.scopeKey).toBe(organizationId);

      const platformEventId = `evt_fup_test_${randomUUID()}`;
      const platformPayload = stripeWebhookPayload({ id: platformEventId });
      await postStripeWebhook(
        app.getHttpServer(),
        platformPayload,
        signStripeWebhook(platformPayload),
      ).expect(200);
      const platformRow = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: platformEventId },
      });
      expect(platformRow.organizationId).toBeNull();
      expect(platformRow.scopeKey).toBe(PLATFORM_SCOPE_KEY);

      const unknownEventId = `evt_fup_test_${randomUUID()}`;
      const unknownPayload = stripeWebhookPayload({
        id: unknownEventId,
        account: `acct_unknown_${randomUUID().slice(0, 8)}`,
      });
      await postStripeWebhook(
        app.getHttpServer(),
        unknownPayload,
        signStripeWebhook(unknownPayload),
      ).expect(200);
      const unknownRow = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: unknownEventId },
      });
      expect(unknownRow.organizationId).toBeNull();
      expect(unknownRow.scopeKey).toBe(PLATFORM_SCOPE_KEY);
    });

    it('stores a deterministic payload hash of the verified event JSON', async () => {
      const eventId = `evt_fup_test_${randomUUID()}`;
      const payload = stripeWebhookPayload({ id: eventId, livemode: false });
      await postStripeWebhook(app.getHttpServer(), payload, signStripeWebhook(payload)).expect(200);
      const row = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: eventId },
      });
      expect(row.payloadHash).toBe(hashPayload(JSON.parse(payload)));
      expect(row.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('does not mutate Payment, Refund, AuditLog, or Outbox on payment_intent.succeeded', async () => {
      const { organizationId } = await registerOrg();
      const accountId = `acct_fup_test_${randomUUID().slice(0, 8)}`;
      await bindStripeAccount(organizationId, accountId);

      const created = await payments.create(
        {
          organizationId,
          amount: '10000',
          currency: 'USD',
          captureMethod: 'AUTOMATIC',
          idempotencyKey: `pay-${randomUUID()}`,
        },
        actor,
      );
      await payments.beginAuthorization(organizationId, created.id, actor);
      await payments.markAuthorized(organizationId, created.id, 10_000n, actor);
      const payment = await payments.markSucceeded(organizationId, created.id, 10_000n, actor);
      const refund = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '2500',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );

      const paymentBefore = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      const refundBefore = await db.refund.findUniqueOrThrow({ where: { id: refund.id } });
      const auditBefore = await db.auditLog.count({ where: { organizationId } });
      const outboxBefore = await db.outboxEvent.count({
        where: { OR: [{ organizationId }, { organizationId: null }] },
      });
      const inboxBefore = await db.inboxEvent.count({
        where: { source: 'stripe', externalEventId: { startsWith: 'evt_fup_test_' } },
      });

      const eventId = `evt_fup_test_${randomUUID()}`;
      const payload = stripeWebhookPayload({
        id: eventId,
        type: 'payment_intent.succeeded',
        account: accountId,
      });
      await postStripeWebhook(app.getHttpServer(), payload, signStripeWebhook(payload)).expect(200);

      const paymentAfter = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      const refundAfter = await db.refund.findUniqueOrThrow({ where: { id: refund.id } });
      expect(paymentAfter).toEqual(paymentBefore);
      expect(refundAfter).toEqual(refundBefore);
      expect(await db.auditLog.count({ where: { organizationId } })).toBe(auditBefore);
      expect(
        await db.outboxEvent.count({
          where: { OR: [{ organizationId }, { organizationId: null }] },
        }),
      ).toBe(outboxBefore);
      expect(
        await db.inboxEvent.count({
          where: { source: 'stripe', externalEventId: { startsWith: 'evt_fup_test_' } },
        }),
      ).toBe(inboxBefore + 1);
    });

    it('deduplicates concurrent unknown and known-account resolution of the same Stripe event', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const { organizationId } = await registerOrg();
        const accountId = `acct_fup_test_${randomUUID().slice(0, 8)}`;
        const eventId = `evt_fup_test_${randomUUID()}`;
        const payload = stripeWebhookPayload({
          id: eventId,
          account: accountId,
        });
        const signature = signStripeWebhook(payload);

        const responses = await Promise.all([
          postStripeWebhook(app.getHttpServer(), payload, signature),
          bindStripeAccount(organizationId, accountId).then(() =>
            postStripeWebhook(app.getHttpServer(), payload, signature),
          ),
        ]);
        for (const response of responses) {
          expect(response.status).toBe(200);
          expect(response.body).toEqual({ received: true });
          expect(JSON.stringify(response.body)).not.toMatch(/P2002|Unique constraint/i);
        }

        const rows = await db.inboxEvent.findMany({
          where: { source: 'stripe', externalEventId: eventId },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.organizationId).toBe(organizationId);
        expect(rows[0]?.scopeKey).toBe(organizationId);
        expect(rows[0]?.payload).toEqual(JSON.parse(payload));
      }
    });
  },
);
