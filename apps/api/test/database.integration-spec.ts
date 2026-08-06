import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigService } from '../src/config/app-config.service';
import { createTestEnvironment } from './support/test-environment';

const databaseUrl = process.env['DATABASE_URL'];

if (databaseUrl === undefined) {
  console.warn(
    'Skipping database integration smoke test: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

/**
 * Real-PostgreSQL smoke test. Not part of `pnpm test` — run explicitly via
 * `pnpm test:api:integration:db` (see apps/api/README.md) against a real,
 * migrated local database. Skips (rather than failing) when DATABASE_URL
 * is unset, so a developer without PostgreSQL configured isn't blocked by
 * the default test suite.
 */
(databaseUrl === undefined ? describe.skip : describe)(
  'Database integration smoke test (real PostgreSQL)',
  () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      if (databaseUrl === undefined) {
        throw new Error('DATABASE_URL must be set to run this test.');
      }

      const environment = createTestEnvironment({ databaseUrl, swaggerEnabled: false });

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule.forRoot(environment)],
      }).compile();

      app = moduleRef.createNestApplication<NestExpressApplication>();
      const config = app.get(AppConfigService);
      configureApp(app, config);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('starts, connects to the real database, and reports readiness as ok', async () => {
      const response = await request(app.getHttpServer()).get('/health/ready').expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        check: 'readiness',
        dependencies: { database: 'up' },
      });
    });
  },
);
