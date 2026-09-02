import pino, { type Logger } from 'pino';
import type { WorkerEnvironment } from './config/environment.types.js';

const REDACT_PATHS = [
  'payload',
  'metadata.password',
  'err.stack',
  '*.password',
  '*.passwordHash',
  '*.secret',
  '*.secretHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.jwtAccessSecret',
  '*.apiKeyHashSecret',
  '*.databaseUrl',
  '*.cardNumber',
  '*.cvc',
  '*.pan',
];

export function createWorkerLogger(environment: WorkerEnvironment, workerId: string): Logger {
  return pino({
    name: 'fraterunion-payments-worker',
    level: environment.nodeEnv === 'test' ? 'silent' : environment.logLevel,
    base: { service: 'fraterunion-payments-worker', workerId },
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    ...(environment.nodeEnv === 'production'
      ? {}
      : { transport: { target: 'pino-pretty', options: { singleLine: true, colorize: true } } }),
  });
}
