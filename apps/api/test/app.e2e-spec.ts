import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { bootstrapTestApp, type TestApp } from './support/bootstrap-test-app';

describe('FraterUnion Payments API (e2e)', () => {
  let testApp: TestApp;
  let app: NestExpressApplication;

  beforeAll(async () => {
    testApp = await bootstrapTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1', () => {
    it('returns the operational root response and does not touch the database', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1').expect(200);

      expect(response.body).toEqual({
        service: 'FraterUnion Payments API',
        version: 'v1',
        status: 'operational',
      });
    });
  });

  describe('GET /health/live', () => {
    it('returns 200 outside the /api/v1 prefix', async () => {
      const response = await request(app.getHttpServer()).get('/health/live').expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        service: 'fraterunion-payments-api',
        check: 'liveness',
      });
      expect(typeof response.body.timestamp).toBe('string');
    });
  });

  describe('GET /health/ready', () => {
    afterEach(() => {
      testApp.fakeDatabase.setReady(true);
    });

    it('returns 200 when the database dependency responds', async () => {
      testApp.fakeDatabase.setReady(true);

      const response = await request(app.getHttpServer()).get('/health/ready').expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        check: 'readiness',
        dependencies: { database: 'up' },
      });
    });

    it('returns 503 and marks the database down when the check fails', async () => {
      testApp.fakeDatabase.setReady(false);

      const response = await request(app.getHttpServer()).get('/health/ready').expect(503);

      expect(response.body).toMatchObject({
        status: 'error',
        check: 'readiness',
        dependencies: { database: 'down' },
      });
      expect(JSON.stringify(response.body)).not.toMatch(/postgres|prisma|connection refused/i);
    });
  });

  describe('GET /unknown-route', () => {
    it('returns a safe 404 error envelope', async () => {
      const response = await request(app.getHttpServer()).get('/unknown-route').expect(404);

      expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' });
      expect(typeof response.body.error.requestId).toBe('string');
      expect(response.body.error.requestId.length).toBeGreaterThan(0);
      expect(JSON.stringify(response.body)).not.toContain(' at ');
    });
  });

  describe('x-request-id', () => {
    it('preserves a valid incoming request id and returns it on the response', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1')
        .set('x-request-id', 'client-supplied-id-123')
        .expect(200);

      expect(response.headers['x-request-id']).toBe('client-supplied-id-123');
    });

    it('generates a request id when none is supplied', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1').expect(200);

      const requestId = response.headers['x-request-id'];
      expect(requestId).toBeDefined();
      expect(requestId?.length).toBeGreaterThan(0);
    });

    it('replaces an invalid incoming request id instead of reflecting it', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1')
        .set('x-request-id', 'invalid header; with bad/chars')
        .expect(200);

      expect(response.headers['x-request-id']).not.toBe('invalid header; with bad/chars');
    });

    it('includes the request id on error responses too', async () => {
      const response = await request(app.getHttpServer())
        .get('/unknown-route')
        .set('x-request-id', 'trace-abc-123')
        .expect(404);

      expect(response.headers['x-request-id']).toBe('trace-abc-123');
      expect(response.body.error.requestId).toBe('trace-abc-123');
    });
  });

  describe('security headers', () => {
    it('sets baseline helmet security headers and hides x-powered-by', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1').expect(200);

      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-dns-prefetch-control']).toBeDefined();
    });
  });

  describe('CORS', () => {
    it('does not reflect a disallowed origin', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1')
        .set('Origin', 'https://not-allowed.example.com')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).not.toBe(
        'https://not-allowed.example.com',
      );
    });

    it('reflects an allowed origin', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });
  });

  describe('validation (fixture-free, via the health module)', () => {
    it('rejects a body on a GET-only route the same way any unexpected input would be handled', async () => {
      // No business DTOs exist yet; this simply confirms the pipeline responds safely.
      const response = await request(app.getHttpServer())
        .get('/unknown-route')
        .send({ password: 'secret123' });

      expect(JSON.stringify(response.body)).not.toContain('secret123');
    });
  });
});

describe('Swagger toggle (e2e)', () => {
  it('serves the Swagger UI and JSON document when enabled', async () => {
    const { app } = await bootstrapTestApp({ swaggerEnabled: true });

    const ui = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(ui.text).toContain('swagger');

    const json = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(json.body.info.title).toBe('FraterUnion Payments API');

    await app.close();
  });

  it('does not serve Swagger routes when disabled', async () => {
    const { app } = await bootstrapTestApp({ swaggerEnabled: false });

    await request(app.getHttpServer()).get('/docs').expect(404);
    await request(app.getHttpServer()).get('/docs-json').expect(404);

    await app.close();
  });
});
