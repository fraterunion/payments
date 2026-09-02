import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@fraterunion-payments/database';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigService } from '../src/config/app-config.service';
import { DatabaseService } from '../src/database/database.service';
import { deleteTenantsForTests, teardownRealPgSuite } from './support/immutable-audit-cleanup';
import { resolveDatabaseUrl } from './support/test-database-url';
import { createTestEnvironment } from './support/test-environment';
import { testEmail, testSlug } from './support/test-ownership';

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl === undefined) {
  console.warn(
    'Skipping payment API e2e suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)('Payments API e2e', () => {
  let app: NestExpressApplication;
  let db: PrismaClient;
  const createdUserIds = new Set<string>();
  const createdOrgIds = new Set<string>();

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
        email: testEmail(`pay-${suffix}`),
        password: `a sufficiently long passphrase ${suffix}`,
        organizationName: `Pay ${suffix}`,
        organizationSlug: testSlug(`pay-${suffix}`),
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

  function createBody(overrides: Record<string, unknown> = {}) {
    return {
      amount: '12500',
      currency: 'USD',
      captureMethod: 'AUTOMATIC',
      ...overrides,
    };
  }

  it('requires authentication, organization context, and an idempotency key', async () => {
    await request(app.getHttpServer()).get('/api/v1/payments').expect(401);
    const { accessToken, organizationId } = await registerOwner();
    await request(app.getHttpServer())
      .get('/api/v1/payments')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set(auth(accessToken, organizationId))
      .send(createBody())
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      });
  });

  it('creates, replays, conflicts, lists, filters, and gets payments', async () => {
    const owner = await registerOwner();
    const headers = auth(owner.accessToken, owner.organizationId);
    const customer = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(headers)
      .send({ name: 'Payer' })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set({ ...headers, 'Idempotency-Key': 'create-1' })
      .send(
        createBody({
          customerId: customer.body.id,
          description: 'Monthly dues',
          metadata: { plan: 'gold' },
        }),
      )
      .expect(201);

    expect(created.body.status).toBe('CREATED');
    expect(created.body.requestedAmount).toBe('12500');
    expect(created.body.authorizedAmount).toBe('0');
    expect(created.body.capturedAmount).toBe('0');
    expect(created.body.refundedAmount).toBe('0');
    expect(created.body.currency).toBe('USD');
    expect(created.body.customerId).toBe(customer.body.id);
    expect(created.body.organizationId).toBeUndefined();
    expect(typeof created.body.requestedAmount).toBe('string');

    const replay = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set({ ...headers, 'Idempotency-Key': 'create-1' })
      .send(
        createBody({
          customerId: customer.body.id,
          description: 'Monthly dues',
          metadata: { plan: 'gold' },
        }),
      )
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set({ ...headers, 'Idempotency-Key': 'create-1' })
      .send(createBody({ customerId: customer.body.id, amount: '15000' }))
      .expect(409)
      .expect((res) => {
        expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
      });

    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set({ ...headers, 'Idempotency-Key': 'create-mxn' })
      .send(createBody({ amount: '5000', currency: 'mxn', captureMethod: 'MANUAL' }))
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/payments')
      .set(headers)
      .expect(200);
    expect(listed.body.items).toHaveLength(2);

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/payments')
      .query({ status: 'CREATED', currency: 'USD', customerId: customer.body.id })
      .set(headers)
      .expect(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].id).toBe(created.body.id);

    const got = await request(app.getHttpServer())
      .get(`/api/v1/payments/${created.body.id}`)
      .set(headers)
      .expect(200);
    expect(got.body.description).toBe('Monthly dues');
  });

  it('paginates newest-first and rejects archived customers for new payments', async () => {
    const owner = await registerOwner();
    const headers = auth(owner.accessToken, owner.organizationId);
    for (const amount of ['1000', '2000', '3000']) {
      await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set({ ...headers, 'Idempotency-Key': `page-${amount}` })
        .send(createBody({ amount }))
        .expect(201);
    }
    const page1 = await request(app.getHttpServer())
      .get('/api/v1/payments?limit=2')
      .set(headers)
      .expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeDefined();
    const page2 = await request(app.getHttpServer())
      .get('/api/v1/payments')
      .query({
        limit: 2,
        cursorCreatedAt: page1.body.nextCursor.createdAt,
        cursorId: page1.body.nextCursor.id,
      })
      .set(headers)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);

    const customer = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(headers)
      .send({ name: 'Archived payer' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customer.body.id}/archive`)
      .set(headers)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set({ ...headers, 'Idempotency-Key': 'archived-customer' })
      .send(createBody({ customerId: customer.body.id }))
      .expect(409)
      .expect((res) => {
        expect(res.body.error.code).toBe('PAYMENT_CUSTOMER_ARCHIVED');
      });
  });

  it('returns safe not-found for cross-tenant ids and does not expose lifecycle endpoints', async () => {
    const a = await registerOwner();
    const b = await registerOwner();
    const created = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set({ ...auth(a.accessToken, a.organizationId), 'Idempotency-Key': 'secret-pay' })
      .send(createBody())
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/payments/${created.body.id}`)
      .set(auth(b.accessToken, b.organizationId))
      .expect(404)
      .expect((res) => {
        expect(res.body.error.code).toBe('PAYMENT_NOT_FOUND');
        expect(res.body.error.message).not.toMatch(/prisma|P20/i);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/payments/${created.body.id}/succeed`)
      .set(auth(a.accessToken, a.organizationId))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${created.body.id}/authorize`)
      .set(auth(a.accessToken, a.organizationId))
      .expect(404);
  });

  it('enforces write RBAC and API-key scopes', async () => {
    const owner = await registerOwner();
    const headers = auth(owner.accessToken, owner.organizationId);

    await db.organizationMembership.update({
      where: {
        organizationId_userId: { organizationId: owner.organizationId, userId: owner.userId },
      },
      data: { role: 'SUPPORT' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set({ ...headers, 'Idempotency-Key': 'support-blocked' })
      .send(createBody())
      .expect(403);

    await db.organizationMembership.update({
      where: {
        organizationId_userId: { organizationId: owner.organizationId, userId: owner.userId },
      },
      data: { role: 'ANALYST' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set({ ...headers, 'Idempotency-Key': 'analyst-blocked' })
      .send(createBody())
      .expect(403);
    await request(app.getHttpServer()).get('/api/v1/payments').set(headers).expect(200);

    await db.organizationMembership.update({
      where: {
        organizationId_userId: { organizationId: owner.organizationId, userId: owner.userId },
      },
      data: { role: 'OWNER' },
    });

    const readKey = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set(headers)
      .send({ name: 'pay-read', environment: 'TEST', scopes: ['payments:read'] })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set({ 'x-api-key': readKey.body.key, 'Idempotency-Key': 'key-blocked' })
      .send(createBody())
      .expect(403);

    const writeKey = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set(headers)
      .send({ name: 'pay-write', environment: 'TEST', scopes: ['payments:write'] })
      .expect(201);
    const fromKey = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set({ 'x-api-key': writeKey.body.key, 'Idempotency-Key': 'key-write' })
      .send(createBody({ amount: '999' }))
      .expect(201);
    expect(fromKey.body.requestedAmount).toBe('999');

    await request(app.getHttpServer())
      .get('/api/v1/payments')
      .set({ 'x-api-key': writeKey.body.key })
      .expect(403);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/payments')
      .set({ 'x-api-key': readKey.body.key })
      .expect(200);
    expect(listed.body.items.length).toBeGreaterThan(0);
  });

  it('rejects decimal amounts and unsafe metadata without leaking Prisma', async () => {
    const owner = await registerOwner();
    const headers = auth(owner.accessToken, owner.organizationId);
    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set({ ...headers, 'Idempotency-Key': 'decimal' })
      .send(createBody({ amount: '125.50' }))
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(res.body)).not.toMatch(/prisma|P2002/i);
      });

    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set({ ...headers, 'Idempotency-Key': 'secret-meta' })
      .send(createBody({ metadata: { password: 'nope' } }))
      .expect(400);
  });
});
