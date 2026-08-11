import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ApiKeyService } from '../services/api-key.service';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';

const API_KEY_HEADER = 'x-api-key';

/**
 * Authenticates server-to-server requests via the `x-api-key` header
 * (chosen over `Authorization: Bearer` specifically to avoid ambiguity with
 * human JWT bearer tokens — see
 * docs/architecture/authentication-and-access-control.md). Attaches an
 * `API_KEY` principal already bound to its organization: API keys need no
 * separate `OrganizationContextGuard` membership lookup, only an
 * organization-status check, which `OrganizationContextGuard` still
 * performs.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers[API_KEY_HEADER];
    const rawKey = Array.isArray(header) ? header[0] : header;

    if (rawKey === undefined || rawKey.length === 0) {
      throw new UnauthorizedException('Missing API key.');
    }

    const authenticated = await this.apiKeyService.authenticate(rawKey);

    request.principal = {
      type: 'API_KEY',
      apiKeyId: authenticated.apiKeyId,
      organizationId: authenticated.organizationId,
      environment: authenticated.environment,
      scopes: authenticated.scopes,
    };

    return true;
  }
}
