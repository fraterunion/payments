import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@fraterunion-payments/database';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigService } from '../src/config/app-config.service';
import { DatabaseService } from '../src/database/database.service';
import { deleteTenantsForTests } from './support/immutable-audit-cleanup';
import { createTestEnvironment } from './support/test-environment';

if (process.env['DATABASE_URL'] === undefined) {
  for (const candidate of [
    resolve(__dirname, '../../../packages/database/.env'),
    resolve(process.cwd(), '../../packages/database/.env'),
  ]) {
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      break;
    }
  }
}

const databaseUrl = process.env['DATABASE_URL'];

if (databaseUrl === undefined) {
  console.warn(
    'Skipping customer API e2e suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)('Customers API e2e', () => {
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
  });

  afterAll(async () => {
    if (db !== undefined) {
      await deleteTenantsForTests(db, [...createdOrgIds], [...createdUserIds]);
    }
    if (app !== undefined) {
      await app.close();
    }
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
        email: `cust-${suffix}@example.com`,
        password: `a sufficiently long passphrase ${suffix}`,
        organizationName: `Cust ${suffix}`,
        organizationSlug: `cust-${suffix}`,
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

  it('requires authentication and organization context', async () => {
    await request(app.getHttpServer()).get('/api/v1/customers').expect(401);
    const { accessToken } = await registerOwner();
    await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(403);
  });

  it('creates, lists, gets, updates, archives, and hides archived by default', async () => {
    const owner = await registerOwner();
    const headers = auth(owner.accessToken, owner.organizationId);

    const created = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(headers)
      .send({
        email: '  Pat@Example.COM  ',
        name: 'Pat',
        phone: '+15551234567',
        externalReference: 'member-pat',
        metadata: { plan: 'monthly' },
      })
      .expect(201);

    expect(created.body.email).toBe('pat@example.com');
    expect(created.body.type).toBe('INDIVIDUAL');
    expect(created.body.organizationId).toBeUndefined();

    const mappings = await request(app.getHttpServer())
      .get(`/api/v1/customers/${created.body.id}/provider-mappings`)
      .set(headers)
      .expect(200);
    expect(mappings.body).toEqual([]);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set(headers)
      .expect(200);
    expect(listed.body.items).toHaveLength(1);

    const got = await request(app.getHttpServer())
      .get(`/api/v1/customers/${created.body.id}`)
      .set(headers)
      .expect(200);
    expect(got.body.name).toBe('Pat');

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${created.body.id}`)
      .set(headers)
      .send({ name: 'Patricia' })
      .expect(200);
    expect(updated.body.name).toBe('Patricia');

    await request(app.getHttpServer())
      .post(`/api/v1/customers/${created.body.id}/archive`)
      .set(headers)
      .expect(201);

    const activeOnly = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set(headers)
      .expect(200);
    expect(activeOnly.body.items).toHaveLength(0);

    const archived = await request(app.getHttpServer())
      .get('/api/v1/customers?status=ARCHIVED')
      .set(headers)
      .expect(200);
    expect(archived.body.items).toHaveLength(1);

    const stillReadable = await request(app.getHttpServer())
      .get(`/api/v1/customers/${created.body.id}`)
      .set(headers)
      .expect(200);
    expect(stillReadable.body.status).toBe('ARCHIVED');

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${created.body.id}`)
      .set(headers)
      .send({ name: 'Nope' })
      .expect(409)
      .expect((res) => {
        expect(res.body.error.code).toBe('CUSTOMER_ARCHIVED');
      });
  });

  it('paginates and searches within the organization', async () => {
    const owner = await registerOwner();
    const headers = auth(owner.accessToken, owner.organizationId);
    for (const name of ['Alpha Gym', 'Beta Studio', 'Gamma Hall']) {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set(headers)
        .send({ name, externalReference: name.split(' ')[0]?.toLowerCase() })
        .expect(201);
    }
    const page1 = await request(app.getHttpServer())
      .get('/api/v1/customers?limit=2')
      .set(headers)
      .expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeDefined();

    const page2 = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .query({
        limit: 2,
        cursorCreatedAt: page1.body.nextCursor.createdAt,
        cursorId: page1.body.nextCursor.id,
      })
      .set(headers)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);

    const search = await request(app.getHttpServer())
      .get('/api/v1/customers?q=beta')
      .set(headers)
      .expect(200);
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].name).toBe('Beta Studio');
  });

  it('returns safe not-found for cross-tenant ids and malformed UUIDs', async () => {
    const a = await registerOwner();
    const b = await registerOwner();
    const created = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(auth(a.accessToken, a.organizationId))
      .send({ name: 'Secret' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/customers/${created.body.id}`)
      .set(auth(b.accessToken, b.organizationId))
      .expect(404)
      .expect((res) => {
        expect(res.body.error.code).toBe('NOT_FOUND');
        expect(res.body.error.message).not.toMatch(/prisma|P20/i);
      });

    await request(app.getHttpServer())
      .get('/api/v1/customers/not-a-uuid')
      .set(auth(a.accessToken, a.organizationId))
      .expect(400);
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
      .post('/api/v1/customers')
      .set(headers)
      .send({ name: 'Blocked' })
      .expect(403);
    await db.organizationMembership.update({
      where: {
        organizationId_userId: { organizationId: owner.organizationId, userId: owner.userId },
      },
      data: { role: 'OWNER' },
    });

    const readKey = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set(headers)
      .send({ name: 'read', environment: 'TEST', scopes: ['customers:read'] })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set({ 'x-api-key': readKey.body.key })
      .send({ name: 'From key' })
      .expect(403);

    const writeKey = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set(headers)
      .send({ name: 'write', environment: 'TEST', scopes: ['customers:write'] })
      .expect(201);
    const fromKey = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set({ 'x-api-key': writeKey.body.key })
      .send({ name: 'From write key' })
      .expect(201);
    expect(fromKey.body.name).toBe('From write key');

    await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set({ 'x-api-key': writeKey.body.key })
      .expect(403);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set({ 'x-api-key': readKey.body.key })
      .expect(200);
    expect(listed.body.items.length).toBeGreaterThan(0);
  });

  it('returns a validation envelope and does not leak Prisma errors', async () => {
    const owner = await registerOwner();
    const headers = auth(owner.accessToken, owner.organizationId);
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(headers)
      .send({ email: 'not-an-email' })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(res.body)).not.toMatch(/prisma|P2002/i);
      });

    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(headers)
      .send({ externalReference: 'dup' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(headers)
      .send({ externalReference: 'dup' })
      .expect(409)
      .expect((res) => {
        expect(res.body.error.code).toBe('CUSTOMER_EXTERNAL_REFERENCE_EXISTS');
        expect(JSON.stringify(res.body)).not.toMatch(/prisma|customers_org/i);
      });
  });
});
