import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ApiKeyService } from '../services/api-key.service';
import type { AuthenticatedApiKey } from '../types/api-key-principal.type';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

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

describe('ApiKeyAuthGuard', () => {
  it('rejects a request with no x-api-key header', async () => {
    const apiKeyService: Pick<ApiKeyService, 'authenticate'> = { authenticate: jest.fn() };
    const guard = new ApiKeyAuthGuard(apiKeyService as ApiKeyService);
    const { context } = createContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(apiKeyService.authenticate).not.toHaveBeenCalled();
  });

  it('propagates the UnauthorizedException from ApiKeyService.authenticate', async () => {
    const apiKeyService: Pick<ApiKeyService, 'authenticate'> = {
      authenticate: jest.fn().mockRejectedValue(new UnauthorizedException('Invalid API key.')),
    };
    const guard = new ApiKeyAuthGuard(apiKeyService as ApiKeyService);
    const { context } = createContext({ 'x-api-key': 'fup_test_bad' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('attaches an API_KEY principal on success', async () => {
    const authenticated: AuthenticatedApiKey = {
      apiKeyId: 'key-1',
      organizationId: 'org-1',
      environment: 'TEST',
      scopes: ['organizations:read'],
    };
    const apiKeyService: Pick<ApiKeyService, 'authenticate'> = {
      authenticate: jest.fn().mockResolvedValue(authenticated),
    };
    const guard = new ApiKeyAuthGuard(apiKeyService as ApiKeyService);
    const { context, request } = createContext({ 'x-api-key': 'fup_test_good' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.principal).toEqual({ type: 'API_KEY', ...authenticated });
  });
});
