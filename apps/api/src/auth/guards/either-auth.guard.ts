import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { HumanJwtAuthGuard } from './human-jwt-auth.guard';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';

const API_KEY_HEADER = 'x-api-key';

/**
 * For the small set of routes usable by either a human session or an API
 * key (in this commit, only the diagnostic `GET /auth/context`). Dispatches
 * on which credential the request presents — `x-api-key` if present,
 * bearer JWT otherwise — rather than trying both, so the failure mode for
 * a malformed API key is a clean 401, not a confusing fallthrough attempt
 * at JWT verification.
 */
@Injectable()
export class EitherAuthGuard implements CanActivate {
  constructor(
    private readonly humanJwtAuthGuard: HumanJwtAuthGuard,
    private readonly apiKeyAuthGuard: ApiKeyAuthGuard,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const hasApiKeyHeader = request.headers[API_KEY_HEADER] !== undefined;

    if (hasApiKeyHeader) {
      return this.apiKeyAuthGuard.canActivate(context);
    }

    return this.humanJwtAuthGuard.canActivate(context);
  }
}
