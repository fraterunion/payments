import jwt from 'jsonwebtoken';
import type { AppConfigService } from '../../config/app-config.service';
import { AccessTokenService } from './access-token.service';

function createFakeAppConfig(
  overrides: Partial<
    Pick<
      AppConfigService,
      'jwtAccessSecret' | 'jwtAccessIssuer' | 'jwtAccessAudience' | 'jwtAccessTtlSeconds'
    >
  > = {},
): Pick<
  AppConfigService,
  'jwtAccessSecret' | 'jwtAccessIssuer' | 'jwtAccessAudience' | 'jwtAccessTtlSeconds'
> {
  return {
    jwtAccessSecret: 'test-secret-at-least-reasonably-long',
    jwtAccessIssuer: 'fraterunion-payments',
    jwtAccessAudience: 'fraterunion-payments-api',
    jwtAccessTtlSeconds: 900,
    ...overrides,
  };
}

describe('AccessTokenService', () => {
  function createService(overrides = {}): AccessTokenService {
    return new AccessTokenService(createFakeAppConfig(overrides) as AppConfigService);
  }

  it('issues a token that verifies back to the same claims', () => {
    const service = createService();
    const token = service.issue({
      userId: 'user-1',
      sessionId: 'session-1',
      email: 'a@example.com',
    });

    const verified = service.verify(token);

    expect(verified).toEqual({ userId: 'user-1', sessionId: 'session-1', email: 'a@example.com' });
  });

  it('signs with the configured issuer, audience, and HS256 algorithm', () => {
    const service = createService();
    const token = service.issue({
      userId: 'user-1',
      sessionId: 'session-1',
      email: 'a@example.com',
    });

    const decoded = jwt.decode(token, { complete: true });
    expect(decoded?.header.alg).toBe('HS256');

    const payload = jwt.decode(token) as Record<string, unknown>;
    expect(payload['iss']).toBe('fraterunion-payments');
    expect(payload['aud']).toBe('fraterunion-payments-api');
    expect(payload['sub']).toBe('user-1');
    expect(typeof payload['iat']).toBe('number');
    expect(typeof payload['exp']).toBe('number');
  });

  it('rejects a token signed with a different secret', () => {
    const service = createService();
    const otherService = createService({ jwtAccessSecret: 'a-completely-different-secret' });
    const token = otherService.issue({
      userId: 'user-1',
      sessionId: 'session-1',
      email: 'a@example.com',
    });

    expect(() => service.verify(token)).toThrow();
  });

  it('rejects a token with the wrong issuer', () => {
    const service = createService();
    const otherService = createService({ jwtAccessIssuer: 'someone-else' });
    const token = otherService.issue({
      userId: 'user-1',
      sessionId: 'session-1',
      email: 'a@example.com',
    });

    expect(() => service.verify(token)).toThrow();
  });

  it('rejects a token with the wrong audience', () => {
    const service = createService();
    const otherService = createService({ jwtAccessAudience: 'someone-elses-api' });
    const token = otherService.issue({
      userId: 'user-1',
      sessionId: 'session-1',
      email: 'a@example.com',
    });

    expect(() => service.verify(token)).toThrow();
  });

  it('rejects an expired token', () => {
    const service = createService({ jwtAccessTtlSeconds: 60 });
    const token = service.issue({
      userId: 'user-1',
      sessionId: 'session-1',
      email: 'a@example.com',
    });

    jest.useFakeTimers().setSystemTime(Date.now() + 120_000);
    expect(() => service.verify(token)).toThrow(jwt.TokenExpiredError);
    jest.useRealTimers();
  });

  it('rejects an unsigned ("none" algorithm) token — closes the algorithm-confusion attack', () => {
    const service = createService();
    const unsigned = jwt.sign({ sid: 'session-1', email: 'a@example.com' }, '', {
      algorithm: 'none',
      subject: 'user-1',
      issuer: 'fraterunion-payments',
      audience: 'fraterunion-payments-api',
    });

    expect(() => service.verify(unsigned)).toThrow();
  });

  it('rejects a token missing the sid claim', () => {
    const service = createService();
    const malformed = jwt.sign({ email: 'a@example.com' }, 'test-secret-at-least-reasonably-long', {
      algorithm: 'HS256',
      subject: 'user-1',
      issuer: 'fraterunion-payments',
      audience: 'fraterunion-payments-api',
    });

    expect(() => service.verify(malformed)).toThrow(jwt.JsonWebTokenError);
  });

  it('rejects a garbage string', () => {
    const service = createService();
    expect(() => service.verify('not.a.jwt')).toThrow();
  });
});
