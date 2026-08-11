import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { MembershipRole } from '@fraterunion-payments/database';
import type { OrganizationScopedRequest } from '../types/authenticated-request.type';
import { RequireRolesGuard } from './require-roles.guard';

function createContext(
  organizationContext: OrganizationScopedRequest['organizationContext'],
): ExecutionContext {
  const request = { organizationContext };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function createFakeReflector(
  requiredRoles: MembershipRole[] | undefined,
): Pick<Reflector, 'getAllAndOverride'> {
  return { getAllAndOverride: jest.fn().mockReturnValue(requiredRoles) };
}

describe('RequireRolesGuard', () => {
  it('allows any role when no @RequireRoles metadata is present', () => {
    const guard = new RequireRolesGuard(createFakeReflector(undefined) as Reflector);
    const context = createContext({ organizationId: 'org-1', role: 'SUPPORT' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a role that is in the required set', () => {
    const guard = new RequireRolesGuard(createFakeReflector(['OWNER', 'ADMIN']) as Reflector);
    const context = createContext({ organizationId: 'org-1', role: 'ADMIN' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a role that is not in the required set', () => {
    const guard = new RequireRolesGuard(createFakeReflector(['OWNER', 'ADMIN']) as Reflector);
    const context = createContext({ organizationId: 'org-1', role: 'ANALYST' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects when organizationContext has no role at all', () => {
    const guard = new RequireRolesGuard(createFakeReflector(['OWNER']) as Reflector);
    const context = createContext({ organizationId: 'org-1' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
