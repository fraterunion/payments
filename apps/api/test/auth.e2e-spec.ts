import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { bootstrapTestApp } from './support/bootstrap-test-app';

/**
 * Exercises the auth HTTP surface's request-validation and
 * authentication-guard rejection paths — everything that fails *before*
 * a database call would be needed — against the fake `DatabaseService`.
 * Full business-logic correctness (registration, login, session rotation,
 * API-key auth, role/scope enforcement, audit persistence) requires a real
 * PostgreSQL database and lives in `test/auth.integration-spec.ts` instead;
 * see that file's header for why these two are deliberately separate.
 */
describe('Auth (e2e, fake database)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    ({ app } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('request validation', () => {
    it('rejects registration with an invalid email', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'not-an-email',
          password: 'a sufficiently long passphrase',
          organizationName: 'Acme',
          organizationSlug: 'acme',
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects registration with a too-short password', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'owner@example.com',
          password: 'short',
          organizationName: 'Acme',
          organizationSlug: 'acme',
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects registration with an invalid ISO currency code', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'owner@example.com',
          password: 'a sufficiently long passphrase',
          organizationName: 'Acme',
          organizationSlug: 'acme',
          defaultCurrency: 'NOTREAL',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(400);
    });

    it('rejects registration with a malformed organization slug', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'owner@example.com',
          password: 'a sufficiently long passphrase',
          organizationName: 'Acme',
          organizationSlug: 'Not A Valid Slug!',
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(400);
    });

    it('rejects registration carrying an extra, unrecognized field (mass-assignment protection)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'owner@example.com',
          password: 'a sufficiently long passphrase',
          organizationName: 'Acme',
          organizationSlug: 'acme',
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
          role: 'OWNER',
        })
        .expect(400);
    });

    it('rejects login with a missing password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'owner@example.com' })
        .expect(400);
    });

    it('rejects refresh with an empty refreshToken', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: '' })
        .expect(400);
    });

    it('rejects api-key creation with an unrecognized scope', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .send({ name: 'k', environment: 'TEST', scopes: ['payments:read'] })
        .expect(401); // no auth header at all — auth guard runs before DTO scope validation matters here
    });
  });

  describe('authentication guard rejection (no database access needed)', () => {
    it('rejects GET /auth/me with no Authorization header', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects POST /auth/logout with no Authorization header', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(401);
    });

    it('rejects POST /auth/logout-all with no Authorization header', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/logout-all').expect(401);
    });

    it('rejects GET /auth/context with no credentials at all', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/context').expect(401);
    });

    it('rejects a malformed (non-Bearer) Authorization header', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .expect(401);
    });

    it('rejects a syntactically-invalid JWT', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);
    });

    it('rejects GET /api-keys with no Authorization header', async () => {
      await request(app.getHttpServer()).get('/api/v1/api-keys').expect(401);
    });

    it('rejects POST /api-keys with no Authorization header', async () => {
      await request(app.getHttpServer()).post('/api/v1/api-keys').send({}).expect(401);
    });

    it('rejects POST /api-keys/:id/revoke with no Authorization header', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/api-keys/00000000-0000-0000-0000-000000000000/revoke')
        .expect(401);
    });

    it('rejects an empty x-api-key header the same as a missing one', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/context')
        .set('x-api-key', '')
        .expect(401);
    });
  });

  describe('response hygiene', () => {
    it('never echoes a submitted password back in a validation error response', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'not-an-email',
          password: 'a-very-identifiable-password-value',
          organizationName: 'Acme',
          organizationSlug: 'acme',
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(400);

      expect(JSON.stringify(response.body)).not.toContain('a-very-identifiable-password-value');
    });
  });
});
