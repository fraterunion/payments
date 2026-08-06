import type { LogLevel, RuntimeEnvironment } from '@fraterunion-payments/config';

/** DI token for the parsed, frozen `Environment` value. */
export const APP_ENVIRONMENT = Symbol('APP_ENVIRONMENT');

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
}
