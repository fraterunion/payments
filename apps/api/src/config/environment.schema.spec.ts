import { EnvironmentValidationError, loadEnvironment } from './environment.schema';

const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  API_PORT: '4000',
  API_HOST: '0.0.0.0',
  API_PREFIX: '/api/',
  API_VERSION: '1',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/fraterunion_test',
  LOG_LEVEL: 'info',
  CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001',
  SWAGGER_ENABLED: 'true',
  TRUST_PROXY: 'false',
  SHUTDOWN_TIMEOUT_MS: '10000',
};

describe('loadEnvironment', () => {
  it('parses a fully valid environment and normalizes derived fields', () => {
    const environment = loadEnvironment(VALID_ENV);

    expect(environment).toEqual({
      nodeEnv: 'development',
      apiPort: 4000,
      apiHost: '0.0.0.0',
      apiPrefix: 'api',
      apiVersion: 1,
      databaseUrl: VALID_ENV['DATABASE_URL'],
      logLevel: 'info',
      corsOrigins: ['http://localhost:3000', 'http://localhost:3001'],
      swaggerEnabled: true,
      trustProxy: false,
      shutdownTimeoutMs: 10000,
    });
  });

  it('is immutable after parsing', () => {
    const environment = loadEnvironment(VALID_ENV);
    expect(Object.isFrozen(environment)).toBe(true);
  });

  it('applies documented defaults when optional variables are omitted', () => {
    const { DATABASE_URL } = VALID_ENV;
    const environment = loadEnvironment({ DATABASE_URL });

    expect(environment.nodeEnv).toBe('development');
    expect(environment.apiPort).toBe(4000);
    expect(environment.apiPrefix).toBe('api');
    expect(environment.swaggerEnabled).toBe(true);
    expect(environment.trustProxy).toBe(false);
    expect(environment.shutdownTimeoutMs).toBe(10000);
  });

  it('throws EnvironmentValidationError when DATABASE_URL is missing', () => {
    const rest = { ...VALID_ENV };
    delete rest['DATABASE_URL'];
    expect(() => loadEnvironment(rest)).toThrow(EnvironmentValidationError);
  });

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    expect(() =>
      loadEnvironment({ ...VALID_ENV, DATABASE_URL: 'mysql://user:pass@host/db' }),
    ).toThrow(EnvironmentValidationError);
  });

  it('never includes the invalid value in the validation error message', () => {
    try {
      loadEnvironment({ ...VALID_ENV, DATABASE_URL: 'mysql://user:supersecret@host/db' });
      throw new Error('expected loadEnvironment to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      const message = (error as EnvironmentValidationError).message;
      expect(message).not.toContain('supersecret');
      expect(message).not.toContain('mysql://');
    }
  });

  it('rejects an out-of-range API_PORT', () => {
    expect(() => loadEnvironment({ ...VALID_ENV, API_PORT: '70000' })).toThrow(
      EnvironmentValidationError,
    );
  });

  it('rejects a non-numeric API_PORT', () => {
    expect(() => loadEnvironment({ ...VALID_ENV, API_PORT: 'not-a-port' })).toThrow(
      EnvironmentValidationError,
    );
  });

  it('rejects an unrecognized SWAGGER_ENABLED value instead of coercing it', () => {
    expect(() => loadEnvironment({ ...VALID_ENV, SWAGGER_ENABLED: 'yes' })).toThrow(
      EnvironmentValidationError,
    );
  });

  it('parses and trims a comma-separated CORS_ORIGINS list', () => {
    const environment = loadEnvironment({
      ...VALID_ENV,
      CORS_ORIGINS: ' http://localhost:3000 , http://localhost:4000 ',
    });
    expect(environment.corsOrigins).toEqual(['http://localhost:3000', 'http://localhost:4000']);
  });

  it('rejects a wildcard CORS_ORIGINS in production', () => {
    expect(() =>
      loadEnvironment({ ...VALID_ENV, NODE_ENV: 'production', CORS_ORIGINS: '*' }),
    ).toThrow(EnvironmentValidationError);
  });

  it('allows a wildcard CORS_ORIGINS outside production', () => {
    const environment = loadEnvironment({
      ...VALID_ENV,
      NODE_ENV: 'development',
      CORS_ORIGINS: '*',
    });
    expect(environment.corsOrigins).toEqual(['*']);
  });

  it('normalizes a prefix with leading and trailing slashes', () => {
    const environment = loadEnvironment({ ...VALID_ENV, API_PREFIX: '/api/' });
    expect(environment.apiPrefix).toBe('api');
  });
});
