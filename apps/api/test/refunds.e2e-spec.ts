import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@fraterunion-payments/database';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigService } from '../src/config/app-config.service';
import { DatabaseService } from '../src/database/database.service';
import { PaymentsService } from '../src/payments/payments.service';
import { deleteTenantsForTests, teardownRealPgSuite } from './support/immutable-audit-cleanup';
import { resolveDatabaseUrl } from './support/test-database-url';
import { createTestEnvironment } from './support/test-environment';
import { testEmail, testSlug } from './support/test-ownership';

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl === undefined) {
  console.warn(
    'Skipping refund API e2e suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)('Refunds API e2e', () => {
  let app: NestExpressApplication;
  let db: PrismaClient;
  let payments: PaymentsService;
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

  async function registerOwner(): Promise<{
    organizationId: string;
    userId: string;
    accessToken: string;
  }> {
    const suffix = randomUUID().slice(0, 8);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: testEmail(`ref-${suffix}`),
        password: `a sufficiently long passphrase ${suffix}`,
        organizationName: `Ref ${suffix}`,
        organizationSlug: testSlug(`ref-${suffix}`),
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

  function auth(token: string, organizationId: string) {
    return {
      Authorization: `Bearer ${token}`,
      'x-organization-id': organizationId,
    };
  }

  async function succeededPayment(
    organizationId: string,
    amount = '10000',
  ): Promise<{ id: string }> {
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
    await payments.markSucceeded(organizationId, created.id, BigInt(amount), actor);
    return created;
  }

  it('requires authentication, organization context, and an idempotency key', async () => {
    await request(app.getHttpServer()).get('/api/v1/refunds').expect(401);
    const { accessToken, organizationId } = await registerOwner();
    const payment = await succeededPayment(organizationId);
    await request(app.getHttpServer())
      .get('/api/v1/refunds')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set(auth(accessToken, organizationId))
      .send({ amount: '5000' })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      });
  });

  it('creates partial and full refunds, replays, conflicts, lists, and gets', async () => {
    const owner = await registerOwner();
    const headers = auth(owner.accessToken, owner.organizationId);
    const payment = await succeededPayment(owner.organizationId);

    const partial = await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set({ ...headers, 'Idempotency-Key': 'refund-partial' })
      .send({ amount: '3000', reason: 'CUSTOMER_REQUEST', metadata: { ticket: 't-1' } })
      .expect(201);

    expect(partial.body.status).toBe('CREATED');
    expect(partial.body.amount).toBe('3000');
    expect(typeof partial.body.amount).toBe('string');
    expect(partial.body.currency).toBe('USD');
    expect(partial.body.paymentId).toBe(payment.id);
    expect(partial.body.organizationId).toBeUndefined();
    expect(partial.body.reason).toBe('CUSTOMER_REQUEST');

    const replay = await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set({ ...headers, 'Idempotency-Key': 'refund-partial' })
      .send({ amount: '3000', reason: 'CUSTOMER_REQUEST', metadata: { ticket: 't-1' } })
      .expect(201);
    expect(replay.body.id).toBe(partial.body.id);

    await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set({ ...headers, 'Idempotency-Key': 'refund-partial' })
      .send({ amount: '4000', reason: 'CUSTOMER_REQUEST' })
      .expect(409)
      .expect((res) => {
        expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
      });

    await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set({ ...headers, 'Idempotency-Key': 'refund-too-big' })
      .send({ amount: '8000' })
      .expect(409)
      .expect((res) => {
        expect(res.body.error.code).toBe('REFUND_AMOUNT_EXCEEDS_AVAILABLE');
      });

    const fullRemainder = await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set({ ...headers, 'Idempotency-Key': 'refund-rest' })
      .send({ amount: '7000', reason: 'DUPLICATE' })
      .expect(201);
    expect(fullRemainder.body.amount).toBe('7000');

    const nested = await request(app.getHttpServer())
      .get(`/api/v1/payments/${payment.id}/refunds`)
      .set(headers)
      .expect(200);
    expect(nested.body.items).toHaveLength(2);

    const global = await request(app.getHttpServer())
      .get('/api/v1/refunds')
      .query({ paymentId: payment.id, status: 'CREATED' })
      .set(headers)
      .expect(200);
    expect(global.body.items.length).toBeGreaterThanOrEqual(2);

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/refunds/${partial.body.id}`)
      .set(headers)
      .expect(200);
    expect(fetched.body.id).toBe(partial.body.id);
    expect(fetched.body.amount).toBe('3000');
  });

  it('hides foreign payments and refunds as not found and has no public status mutation', async () => {
    const a = await registerOwner();
    const b = await registerOwner();
    const payment = await succeededPayment(a.organizationId);
    const created = await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set({
        ...auth(a.accessToken, a.organizationId),
        'Idempotency-Key': 'cross-tenant',
      })
      .send({ amount: '1000' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/refunds/${created.body.id}`)
      .set(auth(b.accessToken, b.organizationId))
      .expect(404)
      .expect((res) => {
        expect(res.body.error.code).toBe('REFUND_NOT_FOUND');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/payments/${payment.id}/refunds`)
      .set(auth(b.accessToken, b.organizationId))
      .expect(404)
      .expect((res) => {
        expect(res.body.error.code).toBe('REFUND_PAYMENT_NOT_FOUND');
      });

    await request(app.getHttpServer())
      .post(`/api/v1/refunds/${created.body.id}/succeed`)
      .set(auth(a.accessToken, a.organizationId))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/refunds/${created.body.id}/process`)
      .set(auth(a.accessToken, a.organizationId))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/refunds/${created.body.id}/fail`)
      .set(auth(a.accessToken, a.organizationId))
      .expect(404);
  });

  it('enforces write RBAC and API-key scopes', async () => {
    const owner = await registerOwner();
    const headers = auth(owner.accessToken, owner.organizationId);
    const payment = await succeededPayment(owner.organizationId);

    await db.organizationMembership.update({
      where: {
        organizationId_userId: { organizationId: owner.organizationId, userId: owner.userId },
      },
      data: { role: 'SUPPORT' },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set({ ...headers, 'Idempotency-Key': 'support-blocked' })
      .send({ amount: '1000' })
      .expect(403);

    await db.organizationMembership.update({
      where: {
        organizationId_userId: { organizationId: owner.organizationId, userId: owner.userId },
      },
      data: { role: 'ANALYST' },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set({ ...headers, 'Idempotency-Key': 'analyst-blocked' })
      .send({ amount: '1000' })
      .expect(403);
    await request(app.getHttpServer()).get('/api/v1/refunds').set(headers).expect(200);

    await db.organizationMembership.update({
      where: {
        organizationId_userId: { organizationId: owner.organizationId, userId: owner.userId },
      },
      data: { role: 'OWNER' },
    });

    const readKey = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set(headers)
      .send({ name: 'ref-read', environment: 'TEST', scopes: ['refunds:read'] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set({ 'x-api-key': readKey.body.key, 'Idempotency-Key': 'key-blocked' })
      .send({ amount: '1000' })
      .expect(403);

    const writeKey = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set(headers)
      .send({ name: 'ref-write', environment: 'TEST', scopes: ['refunds:write'] })
      .expect(201);
    const fromKey = await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set({ 'x-api-key': writeKey.body.key, 'Idempotency-Key': 'key-write' })
      .send({ amount: '999' })
      .expect(201);
    expect(fromKey.body.amount).toBe('999');

    await request(app.getHttpServer())
      .get('/api/v1/refunds')
      .set({ 'x-api-key': writeKey.body.key })
      .expect(403);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/refunds')
      .set({ 'x-api-key': readKey.body.key })
      .expect(200);
    expect(listed.body.items.length).toBeGreaterThan(0);
  });

  it('rejects decimal amounts without leaking Prisma', async () => {
    const owner = await registerOwner();
    const headers = auth(owner.accessToken, owner.organizationId);
    const payment = await succeededPayment(owner.organizationId);
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set({ ...headers, 'Idempotency-Key': 'decimal' })
      .send({ amount: '50.00' })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(res.body)).not.toMatch(/prisma|P2002/i);
      });
  });
});
