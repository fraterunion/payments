import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type {
  AuthenticatedRequest,
  OrganizationScopedRequest,
} from '../types/authenticated-request.type';

const ORGANIZATION_HEADER = 'x-organization-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves and attaches the tenant a request operates against. Never
 * trusts a client-supplied organization id as authority by itself (ADR-003)
 * — a human's `x-organization-id` must match an existing, active
 * membership, and an API key's organization is only ever its own bound
 * `organizationId`, never a header. A membership match that points at a
 * suspended/closed organization is rejected the same as no membership at
 * all: both return a generic 403 that does not confirm whether the
 * organization id exists, so cross-tenant probing learns nothing.
 *
 * Must run after an authentication guard (`HumanJwtAuthGuard`/
 * `ApiKeyAuthGuard`/`EitherAuthGuard`) has attached `request.principal`.
 */
@Injectable()
export class OrganizationContextGuard implements CanActivate {
  constructor(private readonly databaseService: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.principal;

    if (principal === undefined) {
      throw new UnauthorizedException('Authentication required.');
    }

    if (principal.type === 'API_KEY') {
      const organization = await this.databaseService
        .getClient()
        .organization.findUnique({ where: { id: principal.organizationId } });

      if (organization === null || organization.status !== 'ACTIVE') {
        throw new ForbiddenException('Organization is not accessible.');
      }

      (request as OrganizationScopedRequest).organizationContext = {
        organizationId: principal.organizationId,
      };
      return true;
    }

    const header = request.headers[ORGANIZATION_HEADER];
    const organizationId = Array.isArray(header) ? header[0] : header;

    if (organizationId === undefined || !UUID_PATTERN.test(organizationId)) {
      throw new ForbiddenException('A valid x-organization-id header is required.');
    }

    const membership = await this.databaseService.getClient().organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId: principal.userId } },
      include: { organization: true },
    });

    if (membership === null || membership.organization.status !== 'ACTIVE') {
      throw new ForbiddenException('You do not have access to this organization.');
    }

    (request as OrganizationScopedRequest).organizationContext = {
      organizationId,
      role: membership.role,
    };
    return true;
  }
}
