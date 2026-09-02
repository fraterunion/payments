import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createProviderAccountReference } from '@fraterunion-payments/provider-contracts';
import type { PrismaClient } from '@fraterunion-payments/database';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigService } from '../src/config/app-config.service';
import { DatabaseService } from '../src/database/database.service';
import { STRIPE_CONNECT_PROVIDER } from '../src/provider-connections/stripe-connect.tokens';
import { FakeStripeConnectProvider } from './support/fake-stripe-connect-provider';
import { deleteTenantsForTests, teardownRealPgSuite } from './support/immutable-audit-cleanup';
import { resolveDatabaseUrl } from './support/test-database-url';
import { createTestEnvironment } from './support/test-environment';
import { testEmail, testSlug } from './support/test-ownership';

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl === undefined) {
  console.warn(
    'Skipping provider-connection API e2e suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)('Provider connections API e2e', () => {
  let app: NestExpressApplication;
  let db: PrismaClient;
  let fakeConnect: FakeStripeConnectProvider;
  const createdUserIds = new Set<string>();
  const createdOrgIds = new Set<string>();

  beforeAll(async () => {
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL must be set');
    }
    fakeConnect = new FakeStripeConnectProvider();
    const environment = createTestEnvironment({
      databaseUrl,
      swaggerEnabled: false,
      stripeEnabled: true,
      stripeSecretKey: 'sk_test_fake_not_used',
      stripeConnectReturnUrl: 'http://localhost:3000/connect/return',
      stripeConnectRefreshUrl: 'http://localhost:3000/connect/refresh',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(environment)],
    })
      .overrideProvider(STRIPE_CONNECT_PROVIDER)
      .useValue(fakeConnect)
      .compile();
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
        email: testEmail(`pc-${suffix}`),
        password: `a sufficiently long passphrase ${suffix}`,
        organizationName: `Connect ${suffix}`,
        organizationSlug: testSlug(`pc-${suffix}`),
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

  it('requires authentication, organization context, OWNER/ADMIN, and an idempotency key', async () => {
    await request(app.getHttpServer()).get('/api/v1/provider-connections').expect(401);
    const owner = await registerOwner();
    await request(app.getHttpServer())
      .get('/api/v1/provider-connections')
      .set({ Authorization: `Bearer ${owner.accessToken}` })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/provider-connections/stripe')
      .set(auth(owner.accessToken, owner.organizationId))
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      });
  });

  it('creates, replays, lists, gets, onboards, refreshes, and isolates tenants', async () => {
    const owner = await registerOwner();
    const headers = auth(owner.accessToken, owner.organizationId);
    const created = await request(app.getHttpServer())
      .post('/api/v1/provider-connections/stripe')
      .set({ ...headers, 'Idempotency-Key': 'connect-create-1' })
      .expect(201);
    expect(created.body.provider).toBe('stripe');
    expect(created.body.status).toBe('REQUIRES_ACTION');
    expect(created.body.paymentsEnabled).toBe(false);
    expect(created.body).not.toHaveProperty('providerAccountId');
    expect(JSON.stringify(created.body)).not.toContain('acct_');

    const replay = await request(app.getHttpServer())
      .post('/api/v1/provider-connections/stripe')
      .set({ ...headers, 'Idempotency-Key': 'connect-create-1' })
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .post('/api/v1/provider-connections/stripe')
      .set({ ...headers, 'Idempotency-Key': 'connect-create-2' })
      .expect(409)
      .expect((res) => {
        expect(res.body.error.code).toBe('PROVIDER_CONNECTION_ALREADY_EXISTS');
      });

    const listed = await request(app.getHttpServer())
      .get('/api/v1/provider-connections')
      .set(headers)
      .expect(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].id).toBe(created.body.id);

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/provider-connections/${created.body.id}`)
      .set(headers)
      .expect(200);
    expect(fetched.body.id).toBe(created.body.id);

    const link = await request(app.getHttpServer())
      .post(`/api/v1/provider-connections/${created.body.id}/onboarding-link`)
      .set(headers)
      .expect(201);
    expect(link.body.url).toContain('https://connect.stripe.com/');
    expect(link.headers['cache-control']).toBe('no-store');

    const row = await db.providerAccountConnection.findFirstOrThrow({
      where: { id: created.body.id as string },
    });
    fakeConnect.setObservation({
      providerAccountReference: createProviderAccountReference({
        provider: 'stripe',
        id: row.providerAccountId,
      }),
      status: 'ACTIVE',
      paymentsEnabled: true,
      payoutsEnabled: true,
      requirementsDue: false,
      observedAt: new Date('2026-09-02T17:00:00.000Z'),
    });
    const refreshed = await request(app.getHttpServer())
      .post(`/api/v1/provider-connections/${created.body.id}/refresh`)
      .set(headers)
      .expect(201);
    expect(refreshed.body.status).toBe('ACTIVE');
    expect(refreshed.body.paymentsEnabled).toBe(true);

    const other = await registerOwner();
    await request(app.getHttpServer())
      .get(`/api/v1/provider-connections/${created.body.id}`)
      .set(auth(other.accessToken, other.organizationId))
      .expect(404)
      .expect((res) => {
        expect(res.body.error.code).toBe('PROVIDER_CONNECTION_NOT_FOUND');
      });

    await request(app.getHttpServer())
      .delete(`/api/v1/provider-connections/${created.body.id}`)
      .set(headers)
      .expect(404);

    const audits = await db.auditLog.findMany({
      where: { organizationId: owner.organizationId },
    });
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain('connect.stripe.com');
    expect(serialized).not.toContain(link.body.url);
    expect(audits.some((row) => row.action === 'provider_connection.created')).toBe(true);
    expect(audits.some((row) => row.action === 'provider_connection.onboarding_link_created')).toBe(
      true,
    );
    expect(audits.some((row) => row.action === 'provider_connection.refreshed')).toBe(true);
    expect(audits.some((row) => row.action === 'provider_connection.status_changed')).toBe(true);
  });

  it('rejects DEVELOPER and SUPPORT writes and API-key processor connects', async () => {
    const owner = await registerOwner();
    await db.organizationMembership.update({
      where: {
        organizationId_userId: { organizationId: owner.organizationId, userId: owner.userId },
      },
      data: { role: 'DEVELOPER' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/provider-connections/stripe')
      .set({
        ...auth(owner.accessToken, owner.organizationId),
        'Idempotency-Key': 'dev-blocked',
      })
      .expect(403);

    await db.organizationMembership.update({
      where: {
        organizationId_userId: { organizationId: owner.organizationId, userId: owner.userId },
      },
      data: { role: 'SUPPORT' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/provider-connections/stripe')
      .set({
        ...auth(owner.accessToken, owner.organizationId),
        'Idempotency-Key': 'support-blocked',
      })
      .expect(403);

    const admin = await registerOwner();
    await db.organizationMembership.update({
      where: {
        organizationId_userId: { organizationId: admin.organizationId, userId: admin.userId },
      },
      data: { role: 'ADMIN' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/provider-connections/stripe')
      .set({
        ...auth(admin.accessToken, admin.organizationId),
        'Idempotency-Key': 'admin-create',
      })
      .expect(201);

    const key = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set(auth(admin.accessToken, admin.organizationId))
      .send({
        name: 'connect write key',
        environment: 'TEST',
        scopes: ['provider-connections:write', 'provider-connections:read'],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/provider-connections/stripe')
      .set({
        'x-api-key': key.body.key as string,
        'Idempotency-Key': 'api-key-blocked',
      })
      .expect(401);
  });
});
