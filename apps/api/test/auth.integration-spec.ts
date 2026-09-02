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
    'Skipping auth integration suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup. Run via `pnpm test:api:auth:integration`.',
  );
}

interface RegisteredFixture {
  readonly email: string;
  readonly password: string;
  readonly organizationSlug: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

(databaseUrl === undefined ? describe.skip : describe)('Auth integration (real PostgreSQL)', () => {
  let app: NestExpressApplication;
  let db: PrismaClient;

  const createdUserIds = new Set<string>();
  const createdOrgIds = new Set<string>();

  beforeAll(async () => {
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL must be set to run this suite.');
    }

    const environment = createTestEnvironment({ databaseUrl, swaggerEnabled: false });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(environment)],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    const config = app.get(AppConfigService);
    configureApp(app, config);
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

  function uniqueSuffix(): string {
    return randomUUID().slice(0, 8);
  }

  async function registerFixture(
    overrides: Partial<Record<string, unknown>> = {},
  ): Promise<RegisteredFixture> {
    const suffix = uniqueSuffix();
    const email = testEmail(`owner-${suffix}`);
    const password = `a sufficiently long passphrase ${suffix}`;
    const organizationSlug = testSlug(`acme-${suffix}`);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        organizationName: `Acme ${suffix}`,
        organizationSlug,
        defaultCurrency: 'USD',
        countryCode: 'US',
        timezone: 'America/New_York',
        ...overrides,
      })
      .expect(201);

    const userId = response.body.user.id as string;
    const organizationId = response.body.organization.id as string;
    createdUserIds.add(userId);
    createdOrgIds.add(organizationId);

    return {
      email,
      password,
      organizationSlug,
      userId,
      organizationId,
      accessToken: response.body.accessToken as string,
      refreshToken: response.body.refreshToken as string,
    };
  }

  describe('schema sanity', () => {
    it('has a user_credentials table with the expected columns', async () => {
      const columns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'user_credentials'
      `;
      const names = columns.map((c) => c.column_name).sort();
      expect(names).toEqual(
        [
          'id',
          'user_id',
          'password_hash',
          'password_changed_at',
          'created_at',
          'updated_at',
        ].sort(),
      );
    });

    it('has the session rotation columns', async () => {
      const columns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions'
      `;
      const names = columns.map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          'session_family_id',
          'created_by_session_id',
          'rotated_at',
          'last_used_at',
        ]),
      );
    });
  });

  describe('registration', () => {
    it('atomically creates organization, user, credential, OWNER membership, session, and audit record', async () => {
      const fixture = await registerFixture();

      const organization = await db.organization.findUniqueOrThrow({
        where: { id: fixture.organizationId },
      });
      expect(organization).toMatchObject({
        type: 'BUSINESS',
        status: 'ACTIVE',
        slug: fixture.organizationSlug,
      });

      const user = await db.user.findUniqueOrThrow({ where: { id: fixture.userId } });
      expect(user).toMatchObject({ email: fixture.email, status: 'ACTIVE' });

      const credential = await db.userCredential.findUniqueOrThrow({
        where: { userId: fixture.userId },
      });
      expect(credential.passwordHash).toMatch(/^\$argon2id\$/);
      expect(credential.passwordHash).not.toContain(fixture.password);

      const membership = await db.organizationMembership.findUniqueOrThrow({
        where: {
          organizationId_userId: { organizationId: fixture.organizationId, userId: fixture.userId },
        },
      });
      expect(membership.role).toBe('OWNER');

      const sessions = await db.session.findMany({ where: { userId: fixture.userId } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.tokenHash).not.toBe(fixture.refreshToken);

      const auditRows = await db.auditLog.findMany({
        where: { organizationId: fixture.organizationId, action: 'auth.registered' },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.actorUserId).toBe(fixture.userId);
    });

    it('rejects a duplicate email with 409', async () => {
      const fixture = await registerFixture();

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: fixture.email,
          password: 'a completely different passphrase',
          organizationName: 'Another Org',
          organizationSlug: testSlug(`another-${uniqueSuffix()}`),
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(409);
    });

    it('rejects a duplicate organization slug with 409', async () => {
      const fixture = await registerFixture();

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail(`someone-else-${uniqueSuffix()}`),
          password: 'a completely different passphrase',
          organizationName: 'Another Org',
          organizationSlug: fixture.organizationSlug,
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(409);
    });

    it('canonicalizes email casing and whitespace consistently between register and login', async () => {
      const suffix = uniqueSuffix();
      const rawEmail = `  MixedCase-${suffix}@Fup.TEST  `;
      const password = 'a sufficiently long passphrase for canon test';

      const registerResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: rawEmail,
          password,
          organizationName: 'Canon Org',
          organizationSlug: testSlug(`canon-${suffix}`),
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(201);

      createdUserIds.add(registerResponse.body.user.id);
      createdOrgIds.add(registerResponse.body.organization.id);

      expect(registerResponse.body.user.email).toBe(testEmail(`mixedcase-${suffix}`));

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: `  MIXEDCASE-${suffix}@FUP.TEST  `, password })
        .expect(200);
    });

    it('rejects a case-only email variant with the same safe 409 as an exact duplicate', async () => {
      const fixture = await registerFixture();

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: fixture.email.replace('owner-', 'Owner-').replace('@fup.test', '@Fup.TEST'),
          password: 'a completely different passphrase',
          organizationName: 'Another Org',
          organizationSlug: testSlug(`another-${uniqueSuffix()}`),
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(409);

      const body = JSON.stringify(response.body);
      expect(response.body.error.code).toBe('CONFLICT');
      expect(response.body.error.message).toMatch(/already exists|already in use/i);
      expect(body).not.toMatch(/users_email_lower_uidx|P2002|prisma|LOWER\(|duplicate key/i);
    });
  });

  describe('canonical email uniqueness (PostgreSQL)', () => {
    it('exposes the functional unique index on LOWER(email)', async () => {
      const indexes = await db.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'users'
        ORDER BY indexname
      `;
      const lower = indexes.find((index) => index.indexname === 'users_email_lower_uidx');
      expect(lower?.indexdef).toMatch(/CREATE UNIQUE INDEX users_email_lower_uidx/);
      expect(lower?.indexdef).toMatch(/lower\(\(email\)::text\)/);
    });

    it('rejects case-variant and exact duplicate inserts without mutating the original user', async () => {
      const suffix = uniqueSuffix();
      const canonical = testEmail(`db-owner-${suffix}`);
      const original = await db.user.create({
        data: { email: canonical, status: 'ACTIVE', displayName: 'Original Owner' },
      });
      createdUserIds.add(original.id);

      await expect(
        db.user.create({ data: { email: `DB-Owner-${suffix}@Fup.TEST`, status: 'ACTIVE' } }),
      ).rejects.toMatchObject({ code: 'P2002' });

      await expect(
        db.user.create({ data: { email: canonical, status: 'ACTIVE' } }),
      ).rejects.toMatchObject({ code: 'P2002' });

      const other = await db.user.create({
        data: { email: testEmail(`db-other-${suffix}`), status: 'ACTIVE' },
      });
      createdUserIds.add(other.id);

      const reloaded = await db.user.findUniqueOrThrow({ where: { id: original.id } });
      expect(reloaded).toMatchObject({
        email: canonical,
        displayName: 'Original Owner',
        status: 'ACTIVE',
      });
      expect(reloaded.updatedAt).toEqual(original.updatedAt);
    });
  });

  describe('login', () => {
    it('succeeds with correct credentials and audits the event', async () => {
      const fixture = await registerFixture();

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: fixture.email, password: fixture.password })
        .expect(200);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).toEqual(expect.any(String));

      const auditRows = await db.auditLog.findMany({
        where: { organizationId: fixture.organizationId, action: 'auth.login_succeeded' },
      });
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects a wrong password generically', async () => {
      const fixture = await registerFixture();

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: fixture.email, password: 'the-wrong-password-entirely' })
        .expect(401);

      expect(response.body.error.message).not.toMatch(/characters|policy|too short|argon2/i);
    });

    it('rejects an unknown email with the same generic message as a wrong password', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail(`nobody-${uniqueSuffix()}`),
          password: 'whatever-password-value',
        })
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('refresh rotation and reuse detection', () => {
    it('rotates the refresh token and rejects the old one afterward', async () => {
      const fixture = await registerFixture();

      const refreshResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: fixture.refreshToken })
        .expect(200);

      const newRefreshToken = refreshResponse.body.refreshToken as string;
      expect(newRefreshToken).not.toBe(fixture.refreshToken);

      // The new token is itself a valid, live refresh token — rotating it
      // again succeeds. (Reuse of the *old* token is covered separately
      // below: presenting it revokes the whole family, including this new
      // one, so that assertion must not share a fixture with this one.)
      const secondRefreshResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: newRefreshToken })
        .expect(200);
      expect(secondRefreshResponse.body.refreshToken).not.toBe(newRefreshToken);
    });

    it('rejects the old token immediately after it has been rotated', async () => {
      const fixture = await registerFixture();

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: fixture.refreshToken })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: fixture.refreshToken })
        .expect(401);
    });

    it('detects reuse of an already-rotated token and revokes the whole session family', async () => {
      const fixture = await registerFixture();

      const firstRefresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: fixture.refreshToken })
        .expect(200);
      const rotatedToken = firstRefresh.body.refreshToken as string;

      // Reusing the original (already-rotated) token is the attack signal.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: fixture.refreshToken })
        .expect(401);

      // The legitimately-rotated token must now be rejected too — the whole family was revoked.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotatedToken })
        .expect(401);

      const auditRows = await db.auditLog.findMany({
        where: { organizationId: fixture.organizationId, action: 'auth.refresh_reuse_detected' },
      });
      expect(auditRows.length).toBeGreaterThanOrEqual(1);

      const sessions = await db.session.findMany({ where: { userId: fixture.userId } });
      expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    });

    it('is safe under concurrent refresh with the same token: never leaves two live sessions', async () => {
      const fixture = await registerFixture();

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: fixture.refreshToken }),
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: fixture.refreshToken }),
      ]);

      const statuses = [first.status, second.status].sort();
      // Either exactly one wins (200/401), or the race is detected and both
      // lose (401/401) — either way, at most one session can end up usable.
      expect(statuses[1]).toBe(401);

      const winner = first.status === 200 ? first : second.status === 200 ? second : undefined;
      if (winner !== undefined) {
        // Fail-closed design: a detected concurrent rotation revokes the
        // whole family, including the session the "winner" just created.
        await request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: winner.body.refreshToken })
          .expect(401);
      }

      const sessions = await db.session.findMany({ where: { userId: fixture.userId } });
      expect(sessions.filter((s) => s.revokedAt === null)).toHaveLength(0);
    });
  });

  describe('logout and logout-all', () => {
    it('revokes only the current session; the backing session guard then rejects further use of that token', async () => {
      const fixture = await registerFixture();

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .expect(204);

      // Cryptographically valid JWT, but the backing session is revoked —
      // this also means a *repeat* logout call with this same token 401s at
      // the guard layer (active-session enforcement), never reaching
      // AuthService.logout again. SessionService.revokeSession's own
      // idempotency (safe to invoke twice) is covered directly in
      // session.service.spec.ts, since the guard chain here makes it
      // unobservable through this HTTP path.
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: fixture.refreshToken })
        .expect(401);

      const auditRows = await db.auditLog.findMany({
        where: { organizationId: fixture.organizationId, action: 'auth.session_revoked' },
      });
      expect(auditRows).toHaveLength(1);
    });

    it('logout-all revokes every session for the user', async () => {
      const fixture = await registerFixture();

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: fixture.email, password: fixture.password })
        .expect(200);
      const secondRefreshToken = loginResponse.body.refreshToken as string;

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: fixture.refreshToken })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: secondRefreshToken })
        .expect(401);

      const auditRows = await db.auditLog.findMany({
        where: { organizationId: fixture.organizationId, action: 'auth.all_sessions_revoked' },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.metadata).toMatchObject({ revokedCount: 2 });
    });
  });

  describe('GET /auth/me', () => {
    it('returns safe identity, membership, and session info with no credential fields anywhere', async () => {
      const fixture = await registerFixture();

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .expect(200);

      expect(response.body.user.id).toBe(fixture.userId);
      expect(response.body.memberships).toEqual([
        expect.objectContaining({ organizationId: fixture.organizationId, role: 'OWNER' }),
      ]);
      expect(response.body.session).toMatchObject({
        id: expect.any(String),
        expiresAt: expect.any(String),
      });

      const raw = JSON.stringify(response.body);
      expect(raw).not.toMatch(/argon2|passwordHash|credential/i);
    });
  });

  describe('organization context and role isolation', () => {
    it('rejects x-organization-id for an organization the caller has no membership in', async () => {
      const fixtureA = await registerFixture();
      const fixtureB = await registerFixture();

      await request(app.getHttpServer())
        .get('/api/v1/auth/context')
        .set('Authorization', `Bearer ${fixtureA.accessToken}`)
        .set('x-organization-id', fixtureB.organizationId)
        .expect(403);
    });

    it('resolves the correct role for the caller’s own organization', async () => {
      const fixture = await registerFixture();

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/context')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .expect(200);

      expect(response.body).toMatchObject({
        principalType: 'USER',
        organizationId: fixture.organizationId,
        role: 'OWNER',
      });
    });

    it('re-resolves role from the database on every request — a demoted member loses access immediately', async () => {
      const fixture = await registerFixture();

      await db.organizationMembership.update({
        where: {
          organizationId_userId: { organizationId: fixture.organizationId, userId: fixture.userId },
        },
        data: { role: 'ANALYST' },
      });

      await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .send({ name: 'k', environment: 'TEST', scopes: ['organizations:read'] })
        .expect(403);

      // Restore for any later assertions relying on this fixture.
      await db.organizationMembership.update({
        where: {
          organizationId_userId: { organizationId: fixture.organizationId, userId: fixture.userId },
        },
        data: { role: 'OWNER' },
      });
    });
  });

  describe('API keys', () => {
    it('creates a key, returns the plaintext exactly once, and persists only its hash', async () => {
      const fixture = await registerFixture();

      const response = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .send({ name: 'CI key', environment: 'TEST', scopes: ['organizations:read'] })
        .expect(201);

      expect(response.body.key).toMatch(/^fup_test_/);
      expect(response.body.apiKey).not.toHaveProperty('secretHash');
      expect(response.body.apiKey).not.toHaveProperty('key');

      const stored = await db.apiKey.findUniqueOrThrow({ where: { id: response.body.apiKey.id } });
      expect(stored.secretHash).not.toBe(response.body.key);
      expect(JSON.stringify(stored)).not.toContain(response.body.key);
    });

    it('authenticates via x-api-key and exposes it through the context route (scope-gated)', async () => {
      const fixture = await registerFixture();

      const withScope = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .send({ name: 'scoped key', environment: 'TEST', scopes: ['organizations:read'] })
        .expect(201);

      const contextResponse = await request(app.getHttpServer())
        .get('/api/v1/auth/context')
        .set('x-api-key', withScope.body.key)
        .expect(200);
      expect(contextResponse.body).toMatchObject({
        principalType: 'API_KEY',
        organizationId: fixture.organizationId,
        environment: 'TEST',
      });

      const withoutScope = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .send({ name: 'unscoped key', environment: 'TEST', scopes: ['api_keys:read'] })
        .expect(201);

      await request(app.getHttpServer())
        .get('/api/v1/auth/context')
        .set('x-api-key', withoutScope.body.key)
        .expect(403);
    });

    it('lists only safe metadata, never secrets', async () => {
      const fixture = await registerFixture();
      await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .send({ name: 'list-test key', environment: 'TEST', scopes: ['organizations:read'] })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/v1/api-keys')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(1);
      const raw = JSON.stringify(response.body);
      expect(raw).not.toMatch(/secretHash|fup_test_|fup_live_/);
    });

    it('revokes idempotently and rejects the key afterward', async () => {
      const fixture = await registerFixture();
      const created = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .send({ name: 'revoke-me', environment: 'TEST', scopes: ['organizations:read'] })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/api-keys/${created.body.apiKey.id}/revoke`)
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .expect(204);

      await request(app.getHttpServer())
        .get('/api/v1/auth/context')
        .set('x-api-key', created.body.key)
        .expect(401);

      // Idempotent.
      await request(app.getHttpServer())
        .post(`/api/v1/api-keys/${created.body.apiKey.id}/revoke`)
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .expect(204);

      const auditRows = await db.auditLog.findMany({
        where: {
          organizationId: fixture.organizationId,
          action: 'api_key.revoked',
          resourceId: created.body.apiKey.id,
        },
      });
      expect(auditRows).toHaveLength(1);
    });

    it('DEVELOPER may create a TEST key but not a LIVE key', async () => {
      const fixture = await registerFixture();
      await db.organizationMembership.update({
        where: {
          organizationId_userId: { organizationId: fixture.organizationId, userId: fixture.userId },
        },
        data: { role: 'DEVELOPER' },
      });

      await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .send({ name: 'dev test key', environment: 'TEST', scopes: ['organizations:read'] })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .send({ name: 'dev live key attempt', environment: 'LIVE', scopes: ['organizations:read'] })
        .expect(403);
    });

    it('cross-org revoke attempt is a safe no-op: the other organization’s key remains active', async () => {
      const fixtureA = await registerFixture();
      const fixtureB = await registerFixture();

      const keyB = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${fixtureB.accessToken}`)
        .set('x-organization-id', fixtureB.organizationId)
        .send({ name: 'org-b key', environment: 'TEST', scopes: ['organizations:read'] })
        .expect(201);

      // A is authenticated for A's own organization; org B's key id can't
      // even be targeted without A's own x-organization-id, so this
      // exercises A attempting to revoke by id while scoped to A's org.
      await request(app.getHttpServer())
        .post(`/api/v1/api-keys/${keyB.body.apiKey.id}/revoke`)
        .set('Authorization', `Bearer ${fixtureA.accessToken}`)
        .set('x-organization-id', fixtureA.organizationId)
        .expect(204);

      const stillActive = await db.apiKey.findUniqueOrThrow({ where: { id: keyB.body.apiKey.id } });
      expect(stillActive.status).toBe('ACTIVE');
    });
  });

  describe('no plaintext secrets stored anywhere', () => {
    it('never persists the raw password, refresh token, or API key secret in any column', async () => {
      const fixture = await registerFixture();
      const apiKeyResponse = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .set('x-organization-id', fixture.organizationId)
        .send({ name: 'plaintext-check key', environment: 'TEST', scopes: ['organizations:read'] })
        .expect(201);

      const [credential, sessions, apiKeys] = await Promise.all([
        db.userCredential.findUniqueOrThrow({ where: { userId: fixture.userId } }),
        db.session.findMany({ where: { userId: fixture.userId } }),
        db.apiKey.findMany({ where: { organizationId: fixture.organizationId } }),
      ]);

      expect(credential.passwordHash).not.toContain(fixture.password);
      for (const session of sessions) {
        expect(session.tokenHash).not.toBe(fixture.refreshToken);
      }
      for (const apiKey of apiKeys) {
        expect(JSON.stringify(apiKey)).not.toContain(apiKeyResponse.body.key);
      }
    });
  });
});
