import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';
import { RequireScopesGuard } from './require-scopes.guard';

function createContext(principal: AuthenticatedRequest['principal'] | undefined): ExecutionContext {
  const request = { principal };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function createFakeReflector(
  requiredScopes: string[] | undefined,
): Pick<Reflector, 'getAllAndOverride'> {
  return { getAllAndOverride: jest.fn().mockReturnValue(requiredScopes) };
}

describe('RequireScopesGuard', () => {
  it('allows anything when no @RequireScopes metadata is present', () => {
    const guard = new RequireScopesGuard(createFakeReflector(undefined) as Reflector);
    expect(guard.canActivate(createContext(undefined))).toBe(true);
  });

  it('is a no-op for a USER principal — humans are governed by roles, not scopes', () => {
    const guard = new RequireScopesGuard(createFakeReflector(['organizations:read']) as Reflector);
    const context = createContext({
      type: 'USER',
      userId: 'user-1',
      sessionId: 'session-1',
      email: 'a@example.com',
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows an API_KEY principal that holds all required scopes', () => {
    const guard = new RequireScopesGuard(createFakeReflector(['organizations:read']) as Reflector);
    const context = createContext({
      type: 'API_KEY',
      apiKeyId: 'key-1',
      organizationId: 'org-1',
      environment: 'TEST',
      scopes: ['organizations:read', 'api_keys:read'],
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects an API_KEY principal missing a required scope', () => {
    const guard = new RequireScopesGuard(createFakeReflector(['organizations:read']) as Reflector);
    const context = createContext({
      type: 'API_KEY',
      apiKeyId: 'key-1',
      organizationId: 'org-1',
      environment: 'TEST',
      scopes: ['api_keys:read'],
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
