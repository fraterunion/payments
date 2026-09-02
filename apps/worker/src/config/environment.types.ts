import type { LogLevel, RuntimeEnvironment } from '@fraterunion-payments/config';

export interface WorkerEnvironment {
  readonly nodeEnv: RuntimeEnvironment;
  readonly databaseUrl: string;
  readonly logLevel: LogLevel;
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly claimLeaseMs: number;
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
  readonly concurrency: number;
  readonly shutdownTimeoutMs: number;
}
