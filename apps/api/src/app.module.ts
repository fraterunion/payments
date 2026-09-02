import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { PaymentsModule } from './payments/payments.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AppConfigModule } from './config/app-config.module';
import type { Environment } from './config/environment.types';
import { buildLoggerOptions } from './config/logger.options';
import { HealthModule } from './health/health.module';
import { RootModule } from './root/root.module';

@Module({})
export class AppModule {
  /**
   * Takes the already-validated `Environment` as a plain argument (not
   * resolved via DI) so bootstrap can fail fast before Nest's container
   * exists, and so tests can pass a fixture instead of depending on a
   * developer's `.env` (see `test/support/test-environment.ts`).
   *
   * Request-ID assignment is applied via `app.use()` in `app.setup.ts`
   * instead of `NestModule.configure()` — see
   * `common/middleware/request-id.middleware.ts` for why.
   */
  static forRoot(environment: Environment): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(environment),
        LoggerModule.forRoot(buildLoggerOptions(environment)),
        HealthModule,
        RootModule,
        AuthModule,
        CustomersModule,
        PaymentsModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
    };
  }
}
