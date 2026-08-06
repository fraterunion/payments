import { Inject, Injectable } from '@nestjs/common';
import { APP_ENVIRONMENT, type Environment } from './environment.types';

/**
 * Typed accessor for the application's validated configuration. Wraps the
 * frozen `Environment` value injected by `AppConfigModule.forRoot()` rather
 * than exposing it directly, so call sites read named getters instead of
 * indexing into a raw object.
 */
@Injectable()
export class AppConfigService {
  constructor(@Inject(APP_ENVIRONMENT) private readonly environment: Environment) {}

  get nodeEnv(): Environment['nodeEnv'] {
    return this.environment.nodeEnv;
  }

  get isProduction(): boolean {
    return this.environment.nodeEnv === 'production';
  }

  get apiPort(): number {
    return this.environment.apiPort;
  }

  get apiHost(): string {
    return this.environment.apiHost;
  }

  get apiPrefix(): string {
    return this.environment.apiPrefix;
  }

  get apiVersion(): number {
    return this.environment.apiVersion;
  }

  /** Intentionally has no equivalent HTTP-exposed getter/response field. */
  get databaseUrl(): string {
    return this.environment.databaseUrl;
  }

  get logLevel(): Environment['logLevel'] {
    return this.environment.logLevel;
  }

  get corsOrigins(): readonly string[] {
    return this.environment.corsOrigins;
  }

  get swaggerEnabled(): boolean {
    return this.environment.swaggerEnabled;
  }

  get trustProxy(): boolean {
    return this.environment.trustProxy;
  }

  get shutdownTimeoutMs(): number {
    return this.environment.shutdownTimeoutMs;
  }
}
