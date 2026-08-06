import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AppConfigService } from '../../src/config/app-config.service';
import type { Environment } from '../../src/config/environment.types';
import { DatabaseService } from '../../src/database/database.service';
import { FakeDatabaseService } from './fake-database.service';
import { createTestEnvironment } from './test-environment';

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly fakeDatabase: FakeDatabaseService;
}

/**
 * Boots the real `AppModule` through the real `configureApp` setup, with
 * `DatabaseService` swapped for a controlled fake — so most e2e tests never
 * need a real PostgreSQL instance, while still exercising the actual
 * module wiring, middleware, filters, and HTTP setup used in production.
 */
export async function bootstrapTestApp(overrides: Partial<Environment> = {}): Promise<TestApp> {
  const environment = createTestEnvironment(overrides);
  const fakeDatabase = new FakeDatabaseService();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(environment)],
  })
    .overrideProvider(DatabaseService)
    .useValue(fakeDatabase)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  const config = app.get(AppConfigService);
  configureApp(app, config);
  await app.init();

  return { app, fakeDatabase };
}
