import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@fraterunion-payments/database';
import { PLATFORM_SCOPE_KEY } from '@fraterunion-payments/events';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigService } from '../src/config/app-config.service';
import { DatabaseService } from '../src/database/database.service';
import { bootstrapTestApp, type TestApp } from './support/bootstrap-test-app';
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

describe('Stripe webhooks HTTP', () => {
  describe('when STRIPE_WEBHOOK_SECRET is unset', () => {
    let testApp: TestApp;
    let app: NestExpressApplication;

    beforeAll(async () => {
      testApp = await bootstrapTestApp();
      app = testApp.app;
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns 503 PROVIDER_CONFIGURATION_ERROR and does not require auth', async () => {
      const payload = stripeWebhookPayload({ id: `evt_fup_test_${randomUUID()}` });
      const response = await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', signStripeWebhook(payload))
        .send(payload)
        .expect(503);

      expect(response.body.error.code).toBe('PROVIDER_CONFIGURATION_ERROR');
      expect(JSON.stringify(response.body)).not.toMatch(/whsec_/);
    });

    it('does not expose GET and leaves health checks working', async () => {
      await request(app.getHttpServer()).get('/api/v1/webhooks/stripe').expect(404);
      await request(app.getHttpServer()).get('/health/live').expect(200);
    });
  });

  describe('when STRIPE_WEBHOOK_SECRET is configured', () => {
    let testApp: TestApp;
    let app: NestExpressApplication;

    beforeAll(async () => {
      testApp = await bootstrapTestApp({
        stripeWebhookSecret: TEST_STRIPE_WEBHOOK_SECRET,
      });
      app = testApp.app;
    });

    afterAll(async () => {
      await app.close();
    });

    it('rejects a missing or invalid signature without JWT, API key, or org header', async () => {
      const payload = stripeWebhookPayload({ id: `evt_fup_test_${randomUUID()}` });
      const missing = await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(400);
      expect(missing.body.error.code).toBe('STRIPE_WEBHOOK_INVALID_SIGNATURE');

      const invalid = await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 't=1,v1=deadbeef')
        .send(payload)
        .expect(400);
      expect(invalid.body.error.code).toBe('STRIPE_WEBHOOK_INVALID_SIGNATURE');
      expect(JSON.stringify(invalid.body)).not.toMatch(/whsec_|deadbeef|evt_fup_test/);
    });

    it('rejects a tampered body and reconstructed semantically equal JSON', async () => {
      const original = stripeWebhookPayload({ id: `evt_fup_test_${randomUUID()}` });
      const signature = signStripeWebhook(original);
      const tampered = original.replace('succeeded', 'canceled');
      const tamperedResponse = await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', signature)
        .send(tampered)
        .expect(400);
      expect(tamperedResponse.body.error.code).toBe('STRIPE_WEBHOOK_INVALID_SIGNATURE');

      const pretty = JSON.stringify(JSON.parse(original), null, 2);
      expect(pretty).not.toBe(original);
      const reconstructed = await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', signature)
        .send(pretty)
        .expect(400);
      expect(reconstructed.body.error.code).toBe('STRIPE_WEBHOOK_INVALID_SIGNATURE');
    });

    it('rejects malformed JSON after a valid signature envelope', async () => {
      const raw = '{not-json';
      const response = await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', signStripeWebhook(raw))
        .send(raw)
        .expect(400);
      expect(response.body.error.code).toBe('STRIPE_WEBHOOK_INVALID_PAYLOAD');
      expect(JSON.stringify(response.body)).not.toContain('{not-json');
    });

    it('rejects an oversized body without persisting untrusted data', async () => {
      const oversized = `{"id":"${'a'.repeat(1024 * 1024)}"}`;
      const response = await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', signStripeWebhook(oversized))
        .send(oversized)
        .expect(413);
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('does not leak internal identifiers on acknowledgement-shaped errors', async () => {
      const payload = stripeWebhookPayload({ id: `evt_fup_test_${randomUUID()}` });
      const response = await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 't=1,v1=00')
        .send(payload)
        .expect(400);
      expect(response.body).not.toHaveProperty('received');
      expect(JSON.stringify(response.body)).not.toMatch(/inbox|organizationId|connectionId/i);
    });
  });
});

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl === undefined) {
  console.warn(
    'Skipping Stripe webhook persistence e2e: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)(
  'Stripe webhooks API e2e (real PostgreSQL)',
  () => {
    let app: NestExpressApplication;
    let db: PrismaClient;
    const createdUserIds = new Set<string>();
    const createdOrgIds = new Set<string>();

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
      db = app.get(DatabaseService).getClient();
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

    async function registerOwner(): Promise<{
      organizationId: string;
      userId: string;
      accessToken: string;
    }> {
      const suffix = randomUUID().slice(0, 8);
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail(`wh-${suffix}`),
          password: `a sufficiently long passphrase ${suffix}`,
          organizationName: `Webhook ${suffix}`,
          organizationSlug: testSlug(`wh-${suffix}`),
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
        accessToken: response.body.accessToken as string,
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

    it('persists a valid signed connected-account event to the tenant inbox', async () => {
      const owner = await registerOwner();
      const accountId = `acct_fup_test_${randomUUID().slice(0, 8)}`;
      const connectionId = await bindStripeAccount(owner.organizationId, accountId);
      const eventId = `evt_fup_test_${randomUUID()}`;
      const payload = stripeWebhookPayload({
        id: eventId,
        account: accountId,
      });

      const response = await postStripeWebhook(
        app.getHttpServer(),
        payload,
        signStripeWebhook(payload),
      ).expect(200);

      expect(response.body).toEqual({ received: true });
      expect(JSON.stringify(response.body)).not.toMatch(
        new RegExp(`${eventId}|${owner.organizationId}|${connectionId}`),
      );

      const row = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: eventId },
      });
      expect(row.organizationId).toBe(owner.organizationId);
      expect(row.scopeKey).toBe(owner.organizationId);
      expect(row.status).toBe('RECEIVED');
      expect(row.eventType).toBe('payment_intent.succeeded');
      expect(row.payload).toEqual(JSON.parse(payload));
    });

    it('persists a platform event with platform scope', async () => {
      const eventId = `evt_fup_test_${randomUUID()}`;
      const payload = stripeWebhookPayload({ id: eventId });
      await postStripeWebhook(app.getHttpServer(), payload, signStripeWebhook(payload)).expect(200);

      const row = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: eventId },
      });
      expect(row.organizationId).toBeNull();
      expect(row.scopeKey).toBe(PLATFORM_SCOPE_KEY);
    });

    it('persists an unknown connected account as platform-scoped, not an arbitrary tenant', async () => {
      const owner = await registerOwner();
      const eventId = `evt_fup_test_${randomUUID()}`;
      const payload = stripeWebhookPayload({
        id: eventId,
        account: `acct_unknown_${randomUUID().slice(0, 8)}`,
      });
      await postStripeWebhook(app.getHttpServer(), payload, signStripeWebhook(payload)).expect(200);

      const row = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: eventId },
      });
      expect(row.organizationId).toBeNull();
      expect(row.scopeKey).toBe(PLATFORM_SCOPE_KEY);
      const tenantRows = await db.inboxEvent.findMany({
        where: { organizationId: owner.organizationId, externalEventId: eventId },
      });
      expect(tenantRows).toHaveLength(0);
    });

    it('acknowledges duplicate delivery with one logical inbox row', async () => {
      const eventId = `evt_fup_test_${randomUUID()}`;
      const payload = stripeWebhookPayload({ id: eventId });
      const signature = signStripeWebhook(payload);
      await postStripeWebhook(app.getHttpServer(), payload, signature).expect(200);
      const duplicate = await postStripeWebhook(app.getHttpServer(), payload, signature).expect(
        200,
      );
      expect(duplicate.body).toEqual({ received: true });
      expect(
        await db.inboxEvent.count({ where: { source: 'stripe', externalEventId: eventId } }),
      ).toBe(1);
    });

    it('keeps the original payload on a signed conflict and still acknowledges', async () => {
      const eventId = `evt_fup_test_${randomUUID()}`;
      const first = stripeWebhookPayload({
        id: eventId,
        data: { object: { id: 'pi_a', object: 'payment_intent', status: 'succeeded' } },
      });
      const second = stripeWebhookPayload({
        id: eventId,
        data: { object: { id: 'pi_b', object: 'payment_intent', status: 'canceled' } },
      });
      await postStripeWebhook(app.getHttpServer(), first, signStripeWebhook(first)).expect(200);
      await postStripeWebhook(app.getHttpServer(), second, signStripeWebhook(second)).expect(200);

      const row = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: eventId },
      });
      expect(row.payload).toEqual(JSON.parse(first));
      expect(row.payload).not.toEqual(JSON.parse(second));
    });

    it('promotes an unresolved connected-account receipt after the account is bound', async () => {
      const owner = await registerOwner();
      const accountId = `acct_fup_test_${randomUUID().slice(0, 8)}`;
      const eventId = `evt_fup_test_${randomUUID()}`;
      const payload = stripeWebhookPayload({
        id: eventId,
        account: accountId,
      });
      const signature = signStripeWebhook(payload);

      await postStripeWebhook(app.getHttpServer(), payload, signature).expect(200);
      const unresolved = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: eventId },
      });
      expect(unresolved.organizationId).toBeNull();
      expect(unresolved.scopeKey).toBe(PLATFORM_SCOPE_KEY);
      const originalPayload = unresolved.payload;

      await bindStripeAccount(owner.organizationId, accountId);
      await postStripeWebhook(app.getHttpServer(), payload, signature).expect(200);

      const rows = await db.inboxEvent.findMany({
        where: { source: 'stripe', externalEventId: eventId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(unresolved.id);
      expect(rows[0]?.organizationId).toBe(owner.organizationId);
      expect(rows[0]?.scopeKey).toBe(owner.organizationId);
      expect(rows[0]?.payload).toEqual(originalPayload);
    });

    it('does not downgrade a known tenant receipt when the account later cannot be resolved', async () => {
      const owner = await registerOwner();
      const accountId = `acct_fup_test_${randomUUID().slice(0, 8)}`;
      const connectionId = await bindStripeAccount(owner.organizationId, accountId);
      const eventId = `evt_fup_test_${randomUUID()}`;
      const payload = stripeWebhookPayload({
        id: eventId,
        account: accountId,
      });
      const signature = signStripeWebhook(payload);

      await postStripeWebhook(app.getHttpServer(), payload, signature).expect(200);
      await db.providerAccountConnection.delete({ where: { id: connectionId } });
      await postStripeWebhook(app.getHttpServer(), payload, signature).expect(200);

      const rows = await db.inboxEvent.findMany({
        where: { source: 'stripe', externalEventId: eventId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.organizationId).toBe(owner.organizationId);
      expect(rows[0]?.scopeKey).toBe(owner.organizationId);
    });

    it('records a routing conflict instead of moving a Stripe event between tenants', async () => {
      const first = await registerOwner();
      const second = await registerOwner();
      const accountId = `acct_fup_test_${randomUUID().slice(0, 8)}`;
      const connectionId = await bindStripeAccount(first.organizationId, accountId);
      const eventId = `evt_fup_test_${randomUUID()}`;
      const payload = stripeWebhookPayload({
        id: eventId,
        account: accountId,
      });
      const signature = signStripeWebhook(payload);

      await postStripeWebhook(app.getHttpServer(), payload, signature).expect(200);
      await db.providerAccountConnection.delete({ where: { id: connectionId } });
      await bindStripeAccount(second.organizationId, accountId);
      const conflict = await postStripeWebhook(app.getHttpServer(), payload, signature).expect(200);
      expect(conflict.body).toEqual({ received: true });

      const rows = await db.inboxEvent.findMany({
        where: { source: 'stripe', externalEventId: eventId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.organizationId).toBe(first.organizationId);
      expect(rows[0]?.scopeKey).toBe(first.organizationId);
    });

    it('does not persist invalid or tampered deliveries', async () => {
      const eventId = `evt_fup_test_${randomUUID()}`;
      const payload = stripeWebhookPayload({ id: eventId });
      await postStripeWebhook(app.getHttpServer(), payload, 't=1,v1=nope').expect(400);
      const tampered = payload.replace('succeeded', 'canceled');
      await postStripeWebhook(app.getHttpServer(), tampered, signStripeWebhook(payload)).expect(
        400,
      );
      expect(
        await db.inboxEvent.count({ where: { source: 'stripe', externalEventId: eventId } }),
      ).toBe(0);
    });

    it('does not require JWT, API key, or organization headers for a valid delivery', async () => {
      const eventId = `evt_fup_test_${randomUUID()}`;
      const payload = stripeWebhookPayload({ id: eventId });
      const response = await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', signStripeWebhook(payload))
        .send(payload)
        .expect(200);
      expect(response.body).toEqual({ received: true });
    });

    it('leaves authenticated routes working', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
      await request(app.getHttpServer()).get('/health/live').expect(200);
    });
  },
);
