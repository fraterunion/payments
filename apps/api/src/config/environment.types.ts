import type { LogLevel, RuntimeEnvironment } from '@fraterunion-payments/config';

/** DI token for the parsed, frozen `Environment` value. */
export const APP_ENVIRONMENT = Symbol('APP_ENVIRONMENT');

export type AuthCookieSameSite = 'lax' | 'strict' | 'none';

export interface Environment {
  readonly nodeEnv: RuntimeEnvironment;
  readonly apiPort: number;
  readonly apiHost: string;
  readonly apiPrefix: string;
  readonly apiVersion: number;
  readonly databaseUrl: string;
  readonly logLevel: LogLevel;
  readonly corsOrigins: readonly string[];
  readonly swaggerEnabled: boolean;
  readonly trustProxy: boolean;
  readonly shutdownTimeoutMs: number;
  readonly jwtAccessSecret: string;
  readonly jwtAccessIssuer: string;
  readonly jwtAccessAudience: string;
  readonly jwtAccessTtlSeconds: number;
  readonly sessionTtlSeconds: number;
  readonly passwordArgon2MemoryKib: number;
  readonly passwordArgon2TimeCost: number;
  readonly passwordArgon2Parallelism: number;
  readonly apiKeyHashSecret: string;
  readonly authCookieEnabled: boolean;
  readonly authCookieSecure: boolean;
  readonly authCookieSameSite: AuthCookieSameSite;
  readonly stripeEnabled: boolean;
  readonly stripeSecretKey?: string;
  readonly stripeConnectReturnUrl?: string;
  readonly stripeConnectRefreshUrl?: string;
  readonly stripeWebhookSecret?: string;
  readonly stripeWebhookSecretPrevious?: string;
}
