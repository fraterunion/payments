import { LOG_LEVELS, RUNTIME_ENVIRONMENTS } from '@fraterunion-payments/config';
import { z } from 'zod';
import type { WorkerEnvironment } from './environment.types.js';

const MIN_POLL_INTERVAL_MS = 100;
const MAX_POLL_INTERVAL_MS = 60_000;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 500;
const MIN_CLAIM_LEASE_MS = 1_000;
const MAX_CLAIM_LEASE_MS = 3_600_000;
const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 100;
const MIN_RETRY_BASE_MS = 100;
const MAX_RETRY_MAX_MS = 3_600_000;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 100;
const MIN_SHUTDOWN_TIMEOUT_MS = 1_000;
const MAX_SHUTDOWN_TIMEOUT_MS = 300_000;

const rawEnvironmentSchema = z.object({
  NODE_ENV: z.enum(RUNTIME_ENVIRONMENTS).default('development'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
      message: 'DATABASE_URL must use the postgresql:// or postgres:// protocol',
    }),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  WORKER_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(MIN_POLL_INTERVAL_MS)
    .max(MAX_POLL_INTERVAL_MS)
    .default(1_000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(MIN_BATCH_SIZE).max(MAX_BATCH_SIZE).default(25),
  WORKER_CLAIM_LEASE_MS: z.coerce
    .number()
    .int()
    .min(MIN_CLAIM_LEASE_MS)
    .max(MAX_CLAIM_LEASE_MS)
    .default(60_000),
  WORKER_MAX_ATTEMPTS: z.coerce
    .number()
    .int()
    .min(MIN_MAX_ATTEMPTS)
    .max(MAX_MAX_ATTEMPTS)
    .default(10),
  WORKER_RETRY_BASE_MS: z.coerce.number().int().min(MIN_RETRY_BASE_MS).default(1_000),
  WORKER_RETRY_MAX_MS: z.coerce
    .number()
    .int()
    .min(MIN_RETRY_BASE_MS)
    .max(MAX_RETRY_MAX_MS)
    .default(900_000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(MIN_CONCURRENCY).max(MAX_CONCURRENCY).default(5),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(MIN_SHUTDOWN_TIMEOUT_MS)
    .max(MAX_SHUTDOWN_TIMEOUT_MS)
    .default(30_000),
});

export const workerEnvironmentSchema = rawEnvironmentSchema
  .transform((raw): WorkerEnvironment => ({
    nodeEnv: raw.NODE_ENV,
    databaseUrl: raw.DATABASE_URL,
    logLevel: raw.LOG_LEVEL,
    pollIntervalMs: raw.WORKER_POLL_INTERVAL_MS,
    batchSize: raw.WORKER_BATCH_SIZE,
    claimLeaseMs: raw.WORKER_CLAIM_LEASE_MS,
    maxAttempts: raw.WORKER_MAX_ATTEMPTS,
    retryBaseMs: raw.WORKER_RETRY_BASE_MS,
    retryMaxMs: raw.WORKER_RETRY_MAX_MS,
    concurrency: raw.WORKER_CONCURRENCY,
    shutdownTimeoutMs: raw.WORKER_SHUTDOWN_TIMEOUT_MS,
  }))
  .superRefine((environment, ctx) => {
    if (environment.retryMaxMs < environment.retryBaseMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_RETRY_MAX_MS'],
        message: 'WORKER_RETRY_MAX_MS must be greater than or equal to WORKER_RETRY_BASE_MS.',
      });
    }
  });

export class WorkerEnvironmentValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`Invalid worker configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'WorkerEnvironmentValidationError';
  }
}

export function loadWorkerEnvironment(
  source: Record<string, string | undefined>,
): WorkerEnvironment {
  const result = workerEnvironmentSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${field}: ${issue.message}`;
    });
    throw new WorkerEnvironmentValidationError(issues);
  }
  return Object.freeze(result.data);
}
