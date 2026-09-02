import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';
import { REQUEST_ID_HEADER } from '../common/constants/request-id.constants';
import type { Environment } from './environment.types';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["idempotency-key"]',
  'req.headers["stripe-signature"]',
  'req.rawBody',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.secret',
  'req.body.token',
  'req.body.apiKey',
  'req.body.email',
  'req.body.phone',
  'req.body.name',
  'req.body.cardNumber',
  'req.body.cvc',
  '*.password',
  '*.passwordHash',
  '*.secret',
  '*.secretHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.rawKey',
  '*.jwtAccessSecret',
  '*.apiKeyHashSecret',
  '*.stripeWebhookSecret',
  '*.stripeWebhookSecretPrevious',
  '*.webhookSecret',
  '*.databaseUrl',
  '*.cardNumber',
  '*.cvc',
];

/**
 * Builds `nestjs-pino`'s options from validated config. Human-readable
 * (`pino-pretty`) output outside production; structured JSON in production.
 * `req`/`res` are re-serialized narrowly so full headers and bodies are
 * never logged by default, on top of the `redact` list below.
 */
export function buildLoggerOptions(environment: Environment): Params {
  return {
    pinoHttp: {
      name: 'fraterunion-payments-api',
      level: environment.nodeEnv === 'test' ? 'silent' : environment.logLevel,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      genReqId: (req, res) => {
        const existing = (req as { id?: unknown }).id;
        if (typeof existing === 'string' && existing.length > 0) {
          return existing;
        }
        const generated = randomUUID();
        res.setHeader(REQUEST_ID_HEADER, generated);
        return generated;
      },
      serializers: {
        req: (req: { method: string; url: string; id: string }) => ({
          method: req.method,
          url: req.url,
          id: req.id,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      ...(environment.nodeEnv === 'production'
        ? {}
        : { transport: { target: 'pino-pretty', options: { singleLine: true, colorize: true } } }),
    },
  };
}
