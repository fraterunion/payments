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
  JWT_ACCESS_SECRET: 'test-jwt-access-secret',
  JWT_ACCESS_ISSUER: 'fraterunion-payments',
  JWT_ACCESS_AUDIENCE: 'fraterunion-payments-api',
  JWT_ACCESS_TTL_SECONDS: '900',
  SESSION_TTL_SECONDS: '2592000',
  PASSWORD_ARGON2_MEMORY_KIB: '65536',
  PASSWORD_ARGON2_TIME_COST: '3',
  PASSWORD_ARGON2_PARALLELISM: '1',
  API_KEY_HASH_SECRET: 'test-api-key-hash-secret',
  AUTH_COOKIE_ENABLED: 'false',
  AUTH_COOKIE_SECURE: 'false',
  AUTH_COOKIE_SAME_SITE: 'lax',
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
      jwtAccessSecret: 'test-jwt-access-secret',
      jwtAccessIssuer: 'fraterunion-payments',
      jwtAccessAudience: 'fraterunion-payments-api',
      jwtAccessTtlSeconds: 900,
      sessionTtlSeconds: 2592000,
      passwordArgon2MemoryKib: 65536,
      passwordArgon2TimeCost: 3,
      passwordArgon2Parallelism: 1,
      apiKeyHashSecret: 'test-api-key-hash-secret',
      authCookieEnabled: false,
      authCookieSecure: false,
      authCookieSameSite: 'lax',
    });
  });

  it('is immutable after parsing', () => {
    const environment = loadEnvironment(VALID_ENV);
    expect(Object.isFrozen(environment)).toBe(true);
  });

  it('applies documented defaults when optional variables are omitted', () => {
    const { DATABASE_URL, JWT_ACCESS_SECRET, API_KEY_HASH_SECRET } = VALID_ENV;
    const environment = loadEnvironment({ DATABASE_URL, JWT_ACCESS_SECRET, API_KEY_HASH_SECRET });

    expect(environment.nodeEnv).toBe('development');
    expect(environment.apiPort).toBe(4000);
    expect(environment.apiPrefix).toBe('api');
    expect(environment.swaggerEnabled).toBe(true);
    expect(environment.trustProxy).toBe(false);
    expect(environment.shutdownTimeoutMs).toBe(10000);
    expect(environment.jwtAccessIssuer).toBe('fraterunion-payments');
    expect(environment.jwtAccessAudience).toBe('fraterunion-payments-api');
    expect(environment.jwtAccessTtlSeconds).toBe(900);
    expect(environment.sessionTtlSeconds).toBe(2_592_000);
    expect(environment.passwordArgon2MemoryKib).toBe(65_536);
    expect(environment.passwordArgon2TimeCost).toBe(3);
    expect(environment.passwordArgon2Parallelism).toBe(1);
    expect(environment.authCookieEnabled).toBe(false);
    expect(environment.authCookieSecure).toBe(false);
    expect(environment.authCookieSameSite).toBe('lax');
  });

  it('throws EnvironmentValidationError when JWT_ACCESS_SECRET is missing', () => {
    const rest = { ...VALID_ENV };
    delete rest['JWT_ACCESS_SECRET'];
    expect(() => loadEnvironment(rest)).toThrow(EnvironmentValidationError);
  });

  it('throws EnvironmentValidationError when API_KEY_HASH_SECRET is missing', () => {
    const rest = { ...VALID_ENV };
    delete rest['API_KEY_HASH_SECRET'];
    expect(() => loadEnvironment(rest)).toThrow(EnvironmentValidationError);
  });

  it('rejects SESSION_TTL_SECONDS that does not exceed JWT_ACCESS_TTL_SECONDS', () => {
    expect(() =>
      loadEnvironment({
        ...VALID_ENV,
        JWT_ACCESS_TTL_SECONDS: '3600',
        SESSION_TTL_SECONDS: '3600',
      }),
    ).toThrow(EnvironmentValidationError);
  });

  it('rejects JWT_ACCESS_SECRET equal to API_KEY_HASH_SECRET — secrets must never be reused', () => {
    expect(() =>
      loadEnvironment({
        ...VALID_ENV,
        JWT_ACCESS_SECRET: 'shared-secret',
        API_KEY_HASH_SECRET: 'shared-secret',
      }),
    ).toThrow(EnvironmentValidationError);
  });

  it('requires a long JWT_ACCESS_SECRET in production', () => {
    expect(() =>
      loadEnvironment({
        ...VALID_ENV,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com',
        JWT_ACCESS_SECRET: 'short',
      }),
    ).toThrow(EnvironmentValidationError);
  });

  it('accepts a sufficiently long JWT_ACCESS_SECRET in production', () => {
    expect(() =>
      loadEnvironment({
        ...VALID_ENV,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com',
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        API_KEY_HASH_SECRET: 'b'.repeat(32),
      }),
    ).not.toThrow();
  });

  it('requires AUTH_COOKIE_SECURE when AUTH_COOKIE_ENABLED is true in production', () => {
    expect(() =>
      loadEnvironment({
        ...VALID_ENV,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com',
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        API_KEY_HASH_SECRET: 'b'.repeat(32),
        AUTH_COOKIE_ENABLED: 'true',
        AUTH_COOKIE_SECURE: 'false',
      }),
    ).toThrow(EnvironmentValidationError);
  });

  it('rejects AUTH_COOKIE_SAME_SITE=none without AUTH_COOKIE_SECURE=true', () => {
    expect(() =>
      loadEnvironment({
        ...VALID_ENV,
        AUTH_COOKIE_ENABLED: 'true',
        AUTH_COOKIE_SAME_SITE: 'none',
        AUTH_COOKIE_SECURE: 'false',
      }),
    ).toThrow(EnvironmentValidationError);
  });

  it('never includes secret values in the validation error message', () => {
    try {
      loadEnvironment({
        ...VALID_ENV,
        JWT_ACCESS_SECRET: 'shared-super-secret-value',
        API_KEY_HASH_SECRET: 'shared-super-secret-value',
      });
      throw new Error('expected loadEnvironment to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect((error as EnvironmentValidationError).message).not.toContain(
        'shared-super-secret-value',
      );
    }
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
