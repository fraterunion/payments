import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MembershipRole } from '@fraterunion-payments/database';
import { REQUIRE_ROLES_KEY } from '../decorators/require-roles.decorator';
import type { OrganizationScopedRequest } from '../types/authenticated-request.type';

/**
 * Enforces `@RequireRoles(...)` against the role resolved onto
 * `request.organizationContext` by `OrganizationContextGuard` — never
 * against anything the client supplied directly. Routes with no
 * `@RequireRoles` decorator are unaffected (open to any role that already
 * passed organization-context resolution).
 */
@Injectable()
export class RequireRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<MembershipRole[] | undefined>(
      REQUIRE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRoles === undefined || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<OrganizationScopedRequest>();
    const role = request.organizationContext.role;

    if (role === undefined || !requiredRoles.includes(role)) {
      throw new ForbiddenException('You do not have the required role for this action.');
    }

    return true;
  }
}
