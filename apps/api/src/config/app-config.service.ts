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

  /** Intentionally has no equivalent HTTP-exposed getter/response field. */
  get jwtAccessSecret(): string {
    return this.environment.jwtAccessSecret;
  }

  get jwtAccessIssuer(): string {
    return this.environment.jwtAccessIssuer;
  }

  get jwtAccessAudience(): string {
    return this.environment.jwtAccessAudience;
  }

  get jwtAccessTtlSeconds(): number {
    return this.environment.jwtAccessTtlSeconds;
  }

  get sessionTtlSeconds(): number {
    return this.environment.sessionTtlSeconds;
  }

  get passwordArgon2MemoryKib(): number {
    return this.environment.passwordArgon2MemoryKib;
  }

  get passwordArgon2TimeCost(): number {
    return this.environment.passwordArgon2TimeCost;
  }

  get passwordArgon2Parallelism(): number {
    return this.environment.passwordArgon2Parallelism;
  }

  /** Intentionally has no equivalent HTTP-exposed getter/response field. */
  get apiKeyHashSecret(): string {
    return this.environment.apiKeyHashSecret;
  }

  get authCookieEnabled(): boolean {
    return this.environment.authCookieEnabled;
  }

  get authCookieSecure(): boolean {
    return this.environment.authCookieSecure;
  }

  get authCookieSameSite(): Environment['authCookieSameSite'] {
    return this.environment.authCookieSameSite;
  }

  get stripeEnabled(): boolean {
    return this.environment.stripeEnabled;
  }

  /** Intentionally has no equivalent HTTP-exposed getter/response field. */
  get stripeSecretKey(): string | undefined {
    return this.environment.stripeSecretKey;
  }

  get stripeConnectReturnUrl(): string | undefined {
    return this.environment.stripeConnectReturnUrl;
  }

  get stripeConnectRefreshUrl(): string | undefined {
    return this.environment.stripeConnectRefreshUrl;
  }
}
