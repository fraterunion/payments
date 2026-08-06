import type { Environment } from '../../src/config/environment.types';

/**
 * Deterministic configuration for e2e tests — never derived from a
 * developer's `.env`. `databaseUrl` is a syntactically valid placeholder;
 * e2e tests override `DatabaseService` with a fake rather than connecting.
 */
export function createTestEnvironment(overrides: Partial<Environment> = {}): Environment {
  return Object.freeze({
    nodeEnv: 'test',
    apiPort: 0,
    apiHost: '127.0.0.1',
    apiPrefix: 'api',
    apiVersion: 1,
    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/fraterunion_test_placeholder',
    logLevel: 'info',
    corsOrigins: ['http://localhost:3000'],
    swaggerEnabled: true,
    trustProxy: false,
    shutdownTimeoutMs: 1000,
    ...overrides,
  });
}
