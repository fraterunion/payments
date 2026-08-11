import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { SessionService } from '../services/session.service';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';

/**
 * Rejects a request whose access JWT is cryptographically valid but whose
 * backing `Session` has been revoked (logout, logout-all, rotation, or
 * reuse-detected family revocation) or has expired — this is what makes
 * logout actually take effect before the JWT's own `exp`.
 *
 * A no-op for `API_KEY` principals: API keys have no `Session` row to
 * check, and are already fully authenticated by `ApiKeyAuthGuard`. This
 * lets the same guard be composed after either `HumanJwtAuthGuard` or
 * `EitherAuthGuard` without branching at every call site.
 */
@Injectable()
export class ActiveSessionGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.principal;

    if (principal === undefined) {
      throw new UnauthorizedException('Authentication required.');
    }

    if (principal.type !== 'USER') {
      return true;
    }

    const active = await this.sessionService.isSessionActive(principal.sessionId, principal.userId);
    if (!active) {
      throw new UnauthorizedException('Session is no longer active.');
    }

    return true;
  }
}
