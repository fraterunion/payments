import { LOG_LEVELS, RUNTIME_ENVIRONMENTS } from '@fraterunion-payments/config';
import { z } from 'zod';
import type { Environment } from './environment.types';

const MIN_PORT = 1;
const MAX_PORT = 65535;
const MAX_SHUTDOWN_TIMEOUT_MS = 120_000;

/**
 * Minimum secret length required in production, in characters. A secret at
 * or above this length, drawn from a reasonable character set (hex/base64),
 * carries at least ~128 bits of entropy — enough that brute-forcing the
 * secret is infeasible. Not enforced outside production so local
 * development can use short, obviously-non-secret placeholder values.
 */
const MIN_PRODUCTION_SECRET_LENGTH = 32;
const MIN_JWT_ACCESS_TTL_SECONDS = 60;
const MAX_JWT_ACCESS_TTL_SECONDS = 3600;
const MIN_SESSION_TTL_SECONDS = 60;
const MAX_SESSION_TTL_SECONDS = 31_536_000;
const MIN_ARGON2_MEMORY_KIB = 8192;
const MAX_ARGON2_MEMORY_KIB = 1_048_576;
const MAX_ARGON2_TIME_COST = 10;
const MAX_ARGON2_PARALLELISM = 16;
const STRIPE_CONNECT_URL_MAX_LENGTH = 2048;

function optionalNonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function assertConnectRedirectUrl(
  value: string,
  field: string,
  nodeEnv: Environment['nodeEnv'],
): string | undefined {
  if (value.length > STRIPE_CONNECT_URL_MAX_LENGTH) {
    return `${field} exceeds the maximum length.`;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${field} must be an absolute URL.`;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return `${field} must not include credentials.`;
  }
  if (nodeEnv === 'production') {
    if (parsed.protocol !== 'https:') {
      return `${field} must use HTTPS in production.`;
    }
    return undefined;
  }
  const localhost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]';
  if (parsed.protocol === 'https:') {
    return undefined;
  }
  if (parsed.protocol === 'http:' && localhost) {
    return undefined;
  }
  return `${field} must use HTTPS, or HTTP on localhost outside production.`;
}

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
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_ACCESS_ISSUER: z
    .string()
    .min(1, 'JWT_ACCESS_ISSUER must not be empty')
    .default('fraterunion-payments'),
  JWT_ACCESS_AUDIENCE: z
    .string()
    .min(1, 'JWT_ACCESS_AUDIENCE must not be empty')
    .default('fraterunion-payments-api'),
  JWT_ACCESS_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(MIN_JWT_ACCESS_TTL_SECONDS)
    .max(MAX_JWT_ACCESS_TTL_SECONDS)
    .default(900),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(MIN_SESSION_TTL_SECONDS)
    .max(MAX_SESSION_TTL_SECONDS)
    .default(2_592_000),
  PASSWORD_ARGON2_MEMORY_KIB: z.coerce
    .number()
    .int()
    .min(MIN_ARGON2_MEMORY_KIB)
    .max(MAX_ARGON2_MEMORY_KIB)
    .default(65_536),
  PASSWORD_ARGON2_TIME_COST: z.coerce.number().int().min(1).max(MAX_ARGON2_TIME_COST).default(3),
  PASSWORD_ARGON2_PARALLELISM: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_ARGON2_PARALLELISM)
    .default(1),
  API_KEY_HASH_SECRET: z.string().min(1, 'API_KEY_HASH_SECRET is required'),
  AUTH_COOKIE_ENABLED: booleanFlagSchema('false'),
  AUTH_COOKIE_SECURE: booleanFlagSchema('false'),
  AUTH_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  STRIPE_ENABLED: booleanFlagSchema('false'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_CONNECT_RETURN_URL: z.string().optional(),
  STRIPE_CONNECT_REFRESH_URL: z.string().optional(),
});

export const environmentSchema = rawEnvironmentSchema
  .transform((raw): Environment => {
    const stripeSecretKey = optionalNonEmptyString(raw.STRIPE_SECRET_KEY);
    const stripeConnectReturnUrl = optionalNonEmptyString(raw.STRIPE_CONNECT_RETURN_URL);
    const stripeConnectRefreshUrl = optionalNonEmptyString(raw.STRIPE_CONNECT_REFRESH_URL);
    return {
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
      jwtAccessSecret: raw.JWT_ACCESS_SECRET,
      jwtAccessIssuer: raw.JWT_ACCESS_ISSUER,
      jwtAccessAudience: raw.JWT_ACCESS_AUDIENCE,
      jwtAccessTtlSeconds: raw.JWT_ACCESS_TTL_SECONDS,
      sessionTtlSeconds: raw.SESSION_TTL_SECONDS,
      passwordArgon2MemoryKib: raw.PASSWORD_ARGON2_MEMORY_KIB,
      passwordArgon2TimeCost: raw.PASSWORD_ARGON2_TIME_COST,
      passwordArgon2Parallelism: raw.PASSWORD_ARGON2_PARALLELISM,
      apiKeyHashSecret: raw.API_KEY_HASH_SECRET,
      authCookieEnabled: raw.AUTH_COOKIE_ENABLED,
      authCookieSecure: raw.AUTH_COOKIE_SECURE,
      authCookieSameSite: raw.AUTH_COOKIE_SAME_SITE,
      stripeEnabled: raw.STRIPE_ENABLED,
      ...(stripeSecretKey !== undefined ? { stripeSecretKey } : {}),
      ...(stripeConnectReturnUrl !== undefined ? { stripeConnectReturnUrl } : {}),
      ...(stripeConnectRefreshUrl !== undefined ? { stripeConnectRefreshUrl } : {}),
    };
  })
  .superRefine((environment, ctx) => {
    if (environment.nodeEnv === 'production' && environment.corsOrigins.includes('*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must not include a wildcard ("*") in production.',
      });
    }

    if (environment.sessionTtlSeconds <= environment.jwtAccessTtlSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_TTL_SECONDS'],
        message: 'SESSION_TTL_SECONDS must exceed JWT_ACCESS_TTL_SECONDS.',
      });
    }

    if (environment.nodeEnv === 'production') {
      if (environment.jwtAccessSecret.length < MIN_PRODUCTION_SECRET_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: `JWT_ACCESS_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production.`,
        });
      }

      if (environment.apiKeyHashSecret.length < MIN_PRODUCTION_SECRET_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['API_KEY_HASH_SECRET'],
          message: `API_KEY_HASH_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production.`,
        });
      }

      if (environment.authCookieEnabled && !environment.authCookieSecure) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_COOKIE_SECURE'],
          message:
            'AUTH_COOKIE_SECURE must be true in production when AUTH_COOKIE_ENABLED is true.',
        });
      }
    }

    // Never reused, and never compared by logging either value.
    if (
      environment.jwtAccessSecret.length > 0 &&
      environment.jwtAccessSecret === environment.apiKeyHashSecret
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_KEY_HASH_SECRET'],
        message: 'API_KEY_HASH_SECRET must not equal JWT_ACCESS_SECRET.',
      });
    }

    if (
      environment.authCookieEnabled &&
      environment.authCookieSameSite === 'none' &&
      !environment.authCookieSecure
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_COOKIE_SAME_SITE'],
        message: 'AUTH_COOKIE_SAME_SITE=none requires AUTH_COOKIE_SECURE=true.',
      });
    }

    if (environment.stripeEnabled) {
      if (environment.stripeSecretKey === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STRIPE_SECRET_KEY'],
          message: 'STRIPE_SECRET_KEY is required when STRIPE_ENABLED is true.',
        });
      } else if (
        environment.nodeEnv !== 'production' &&
        environment.stripeSecretKey.startsWith('sk_live_')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STRIPE_SECRET_KEY'],
          message: 'Live Stripe credentials are not permitted outside production.',
        });
      }

      if (environment.stripeConnectReturnUrl === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STRIPE_CONNECT_RETURN_URL'],
          message: 'STRIPE_CONNECT_RETURN_URL is required when STRIPE_ENABLED is true.',
        });
      } else {
        const issue = assertConnectRedirectUrl(
          environment.stripeConnectReturnUrl,
          'STRIPE_CONNECT_RETURN_URL',
          environment.nodeEnv,
        );
        if (issue !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['STRIPE_CONNECT_RETURN_URL'],
            message: issue,
          });
        }
      }

      if (environment.stripeConnectRefreshUrl === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STRIPE_CONNECT_REFRESH_URL'],
          message: 'STRIPE_CONNECT_REFRESH_URL is required when STRIPE_ENABLED is true.',
        });
      } else {
        const issue = assertConnectRedirectUrl(
          environment.stripeConnectRefreshUrl,
          'STRIPE_CONNECT_REFRESH_URL',
          environment.nodeEnv,
        );
        if (issue !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['STRIPE_CONNECT_REFRESH_URL'],
            message: issue,
          });
        }
      }
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
