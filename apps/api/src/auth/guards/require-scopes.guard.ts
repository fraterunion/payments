import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_SCOPES_KEY } from '../decorators/require-scopes.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';

/**
 * Enforces `@RequireScopes(...)` against an `API_KEY` principal's scopes.
 * A no-op for `USER` principals: human access is governed by
 * `RequireRolesGuard` instead, not scopes — this lets the same decorator
 * guard a mixed-principal route (like `GET /auth/context`) without a human
 * caller needing any scope at all.
 */
@Injectable()
export class RequireScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRE_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredScopes === undefined || requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.principal;

    if (principal === undefined || principal.type !== 'API_KEY') {
      return true;
    }

    const hasAllScopes = requiredScopes.every((scope) => principal.scopes.includes(scope));
    if (!hasAllScopes) {
      throw new ForbiddenException(
        'This API key does not have the required scope(s) for this action.',
      );
    }

    return true;
  }
}
