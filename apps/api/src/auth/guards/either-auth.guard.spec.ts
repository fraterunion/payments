import type { ExecutionContext } from '@nestjs/common';
import type { ApiKeyAuthGuard } from './api-key-auth.guard';
import { EitherAuthGuard } from './either-auth.guard';
import type { HumanJwtAuthGuard } from './human-jwt-auth.guard';

function createContext(headers: Record<string, string | undefined>): ExecutionContext {
  const request = { headers };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('EitherAuthGuard', () => {
  it('dispatches to ApiKeyAuthGuard when x-api-key is present', () => {
    const humanGuard: Pick<HumanJwtAuthGuard, 'canActivate'> = { canActivate: jest.fn() };
    const apiKeyGuard: Pick<ApiKeyAuthGuard, 'canActivate'> = {
      canActivate: jest.fn().mockResolvedValue(true),
    };
    const guard = new EitherAuthGuard(
      humanGuard as HumanJwtAuthGuard,
      apiKeyGuard as ApiKeyAuthGuard,
    );

    guard.canActivate(createContext({ 'x-api-key': 'fup_test_x' }));

    expect(apiKeyGuard.canActivate).toHaveBeenCalledTimes(1);
    expect(humanGuard.canActivate).not.toHaveBeenCalled();
  });

  it('dispatches to HumanJwtAuthGuard when x-api-key is absent', () => {
    const humanGuard: Pick<HumanJwtAuthGuard, 'canActivate'> = {
      canActivate: jest.fn().mockReturnValue(true),
    };
    const apiKeyGuard: Pick<ApiKeyAuthGuard, 'canActivate'> = { canActivate: jest.fn() };
    const guard = new EitherAuthGuard(
      humanGuard as HumanJwtAuthGuard,
      apiKeyGuard as ApiKeyAuthGuard,
    );

    guard.canActivate(createContext({ authorization: 'Bearer token' }));

    expect(humanGuard.canActivate).toHaveBeenCalledTimes(1);
    expect(apiKeyGuard.canActivate).not.toHaveBeenCalled();
  });
});
