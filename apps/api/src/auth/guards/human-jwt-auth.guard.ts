import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccessTokenService } from '../services/access-token.service';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';

function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (authorizationHeader === undefined) return undefined;
  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0) {
    return undefined;
  }
  return token;
}

/**
 * Verifies the access JWT's signature, issuer, audience, algorithm, and
 * expiry, and attaches a `USER` principal. Deliberately does not check
 * whether the backing session is still active — that is
 * `ActiveSessionGuard`'s job, composed after this one, so a cryptographic
 * check and a database check stay in separate, independently testable
 * guards (see docs/architecture/authentication-and-access-control.md).
 */
@Injectable()
export class HumanJwtAuthGuard implements CanActivate {
  constructor(private readonly accessTokenService: AccessTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (token === undefined) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    let verified;
    try {
      verified = this.accessTokenService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }

    if (verified.email === undefined) {
      throw new UnauthorizedException('Invalid access token.');
    }

    request.principal = {
      type: 'USER',
      userId: verified.userId,
      sessionId: verified.sessionId,
      email: verified.email,
    };

    return true;
  }
}
