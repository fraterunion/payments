import { LOG_LEVELS, RUNTIME_ENVIRONMENTS } from '@fraterunion-payments/config';
import { z } from 'zod';
import type { Environment } from './environment.types';

const MIN_PORT = 1;
const MAX_PORT = 65535;
const MAX_SHUTDOWN_TIMEOUT_MS = 120_000;

function booleanFlagSchema(defaultValue: 'true' | 'false') {
  return z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');
}

const rawEnvironmentSchema = z.object({
  NODE_ENV: z.enum(RUNTIME_ENVIRONMENTS).default('development'),
  API_PORT: z.coerce.number().int().min(MIN_PORT).max(MAX_PORT).default(4000),
  API_HOST: z.string().min(1, 'API_HOST must not be empty').default('0.0.0.0'),
  API_PREFIX: z
    .string()
    .default('api')
    .transform((value) => value.replace(/^\/+/, '').replace(/\/+$/, '')),
  API_VERSION: z.coerce.number().int().positive().default(1),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
      message: 'DATABASE_URL must use the postgresql:// or postgres:// protocol',
    }),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  CORS_ORIGINS: z
    .string()
    .min(1, 'CORS_ORIGINS must not be empty')
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  SWAGGER_ENABLED: booleanFlagSchema('true'),
  TRUST_PROXY: booleanFlagSchema('false'),
  SHUTDOWN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_SHUTDOWN_TIMEOUT_MS)
    .default(10_000),
});

export const environmentSchema = rawEnvironmentSchema
  .transform((raw): Environment => ({
    nodeEnv: raw.NODE_ENV,
    apiPort: raw.API_PORT,
    apiHost: raw.API_HOST,
    apiPrefix: raw.API_PREFIX,
    apiVersion: raw.API_VERSION,
    databaseUrl: raw.DATABASE_URL,
    logLevel: raw.LOG_LEVEL,
    corsOrigins: raw.CORS_ORIGINS,
    swaggerEnabled: raw.SWAGGER_ENABLED,
    trustProxy: raw.TRUST_PROXY,
    shutdownTimeoutMs: raw.SHUTDOWN_TIMEOUT_MS,
  }))
  .superRefine((environment, ctx) => {
    if (environment.nodeEnv === 'production' && environment.corsOrigins.includes('*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must not include a wildcard ("*") in production.',
      });
    }
  });

export class EnvironmentValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'EnvironmentValidationError';
  }
}

/**
 * Parses and validates `process.env` (or an equivalent source) into a
 * frozen `Environment`. Throws `EnvironmentValidationError` with one line
 * per field on failure — field names and validation messages only, never
 * the invalid value itself, since a field like `DATABASE_URL` may carry
 * credentials.
 */
export function loadEnvironment(source: Record<string, string | undefined>): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${field}: ${issue.message}`;
    });
    throw new EnvironmentValidationError(issues);
  }

  return Object.freeze(result.data);
}
