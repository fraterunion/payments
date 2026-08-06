import { Module, type DynamicModule } from '@nestjs/common';
import { AppConfigService } from './app-config.service';
import { APP_ENVIRONMENT, type Environment } from './environment.types';

/**
 * Global so every module can inject `AppConfigService` without each one
 * re-importing this module — justified because configuration is read
 * throughout the app (database, health, bootstrap), unlike `DatabaseModule`.
 *
 * Takes the already-validated `Environment` as a plain value rather than
 * parsing `process.env` itself, so tests can supply a fixture directly
 * (see `AppModule.forRoot`) instead of depending on a developer's `.env`.
 */
@Module({})
export class AppConfigModule {
  static forRoot(environment: Environment): DynamicModule {
    return {
      module: AppConfigModule,
      global: true,
      providers: [{ provide: APP_ENVIRONMENT, useValue: environment }, AppConfigService],
      exports: [AppConfigService],
    };
  }
}
