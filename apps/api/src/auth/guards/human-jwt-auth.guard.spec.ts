import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AccessTokenService, VerifiedAccessToken } from '../services/access-token.service';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';
import { HumanJwtAuthGuard } from './human-jwt-auth.guard';

function createContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  request: Partial<AuthenticatedRequest>;
} {
  const request: Partial<AuthenticatedRequest> = { headers: headers as never };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function createFakeAccessTokenService(
  verifyImpl: (token: string) => VerifiedAccessToken,
): Pick<AccessTokenService, 'verify'> {
  return { verify: jest.fn(verifyImpl) };
}

describe('HumanJwtAuthGuard', () => {
  it('rejects a request with no authorization header', () => {
    const guard = new HumanJwtAuthGuard(
      createFakeAccessTokenService(() => {
        throw new Error('should not be called');
      }) as AccessTokenService,
    );
    const { context } = createContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a non-Bearer authorization header', () => {
    const guard = new HumanJwtAuthGuard(
      createFakeAccessTokenService(() => {
        throw new Error('should not be called');
      }) as AccessTokenService,
    );
    const { context } = createContext({ authorization: 'Basic abc123' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects when the underlying JWT verification throws', () => {
    const guard = new HumanJwtAuthGuard(
      createFakeAccessTokenService(() => {
        throw new Error('invalid signature');
      }) as AccessTokenService,
    );
    const { context } = createContext({ authorization: 'Bearer bad.token.value' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('attaches a USER principal for a valid token', () => {
    const guard = new HumanJwtAuthGuard(
      createFakeAccessTokenService(() => ({
        userId: 'user-1',
        sessionId: 'session-1',
        email: 'a@example.com',
      })) as AccessTokenService,
    );
    const { context, request } = createContext({ authorization: 'Bearer good.token.value' });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.principal).toEqual({
      type: 'USER',
      userId: 'user-1',
      sessionId: 'session-1',
      email: 'a@example.com',
    });
  });

  it('rejects a verified token missing the email claim', () => {
    const guard = new HumanJwtAuthGuard(
      createFakeAccessTokenService(() => ({
        userId: 'user-1',
        sessionId: 'session-1',
      })) as AccessTokenService,
    );
    const { context } = createContext({ authorization: 'Bearer good.token.value' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
