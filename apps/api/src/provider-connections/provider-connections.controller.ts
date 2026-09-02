import {
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@fraterunion-payments/database';
import { AuditActor } from '../audit/audit.types';
import { CurrentOrganizationContext } from '../auth/decorators/current-organization-context.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { RequireRoles } from '../auth/decorators/require-roles.decorator';
import { RequireScopes } from '../auth/decorators/require-scopes.decorator';
import { ActiveSessionGuard } from '../auth/guards/active-session.guard';
import { EitherAuthGuard } from '../auth/guards/either-auth.guard';
import { HumanJwtAuthGuard } from '../auth/guards/human-jwt-auth.guard';
import { OrganizationContextGuard } from '../auth/guards/organization-context.guard';
import { RequireRolesGuard } from '../auth/guards/require-roles.guard';
import { RequireScopesGuard } from '../auth/guards/require-scopes.guard';
import type { OrganizationContext } from '../auth/types/organization-context.type';
import type { Principal } from '../auth/types/principal.type';
import { extractRequestContext } from '../auth/utils/request-context.util';
import type { RequestWithId } from '../common/types/request-with-id.type';
import {
  ProviderConnectionListResponseDto,
  ProviderConnectionResponseDto,
  ProviderOnboardingLinkResponseDto,
} from './dto/provider-connection-responses.dto';
import {
  toProviderConnectionResponse,
  ProviderAccountConnectionService,
} from './provider-connections.service';

const READ_ROLES = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.DEVELOPER,
  MembershipRole.ANALYST,
  MembershipRole.SUPPORT,
] as const;

const WRITE_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN] as const;

function actorFromPrincipal(principal: Principal): AuditActor {
  if (principal.type === 'USER') {
    return { type: 'USER', userId: principal.userId };
  }
  return { type: 'API_KEY', apiKeyId: principal.apiKeyId };
}

@ApiTags('Provider connections')
@ApiBearerAuth('bearer')
@Controller('provider-connections')
export class ProviderConnectionsController {
  constructor(private readonly connections: ProviderAccountConnectionService) {}

  @Post('stripe')
  @UseGuards(HumanJwtAuthGuard, ActiveSessionGuard, OrganizationContextGuard, RequireRolesGuard)
  @RequireRoles(...WRITE_ROLES)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: ProviderConnectionResponseDto })
  async createStripe(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: Principal,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
    @Req() req: RequestWithId,
  ): Promise<ProviderConnectionResponseDto> {
    const created = await this.connections.createStripe(
      {
        organizationId: organizationContext.organizationId,
        idempotencyKey: idempotencyKey ?? '',
      },
      actorFromPrincipal(principal),
      extractRequestContext(req),
    );
    return toProviderConnectionResponse(created);
  }

  @Get()
  @UseGuards(
    EitherAuthGuard,
    ActiveSessionGuard,
    OrganizationContextGuard,
    RequireRolesGuard,
    RequireScopesGuard,
  )
  @RequireRoles(...READ_ROLES)
  @RequireScopes('provider-connections:read')
  @ApiSecurity('apiKey')
  @ApiOkResponse({ type: ProviderConnectionListResponseDto })
  async list(
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
  ): Promise<ProviderConnectionListResponseDto> {
    const items = await this.connections.list(organizationContext.organizationId);
    return { items: items.map(toProviderConnectionResponse) };
  }

  @Get(':connectionId')
  @UseGuards(
    EitherAuthGuard,
    ActiveSessionGuard,
    OrganizationContextGuard,
    RequireRolesGuard,
    RequireScopesGuard,
  )
  @RequireRoles(...READ_ROLES)
  @RequireScopes('provider-connections:read')
  @ApiSecurity('apiKey')
  @ApiOkResponse({ type: ProviderConnectionResponseDto })
  async get(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
  ): Promise<ProviderConnectionResponseDto> {
    const connection = await this.connections.get(organizationContext.organizationId, connectionId);
    return toProviderConnectionResponse(connection);
  }

  @Post(':connectionId/onboarding-link')
  @UseGuards(HumanJwtAuthGuard, ActiveSessionGuard, OrganizationContextGuard, RequireRolesGuard)
  @RequireRoles(...WRITE_ROLES)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: ProviderOnboardingLinkResponseDto })
  async createOnboardingLink(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @CurrentPrincipal() principal: Principal,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
    @Req() req: RequestWithId,
  ): Promise<ProviderOnboardingLinkResponseDto> {
    return this.connections.createOnboardingLink(
      organizationContext.organizationId,
      connectionId,
      actorFromPrincipal(principal),
      extractRequestContext(req),
    );
  }

  @Post(':connectionId/refresh')
  @UseGuards(
    EitherAuthGuard,
    ActiveSessionGuard,
    OrganizationContextGuard,
    RequireRolesGuard,
    RequireScopesGuard,
  )
  @RequireRoles(...WRITE_ROLES)
  @RequireScopes('provider-connections:write')
  @ApiSecurity('apiKey')
  @ApiOkResponse({ type: ProviderConnectionResponseDto })
  async refresh(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @CurrentPrincipal() principal: Principal,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
    @Req() req: RequestWithId,
  ): Promise<ProviderConnectionResponseDto> {
    const refreshed = await this.connections.refresh(
      organizationContext.organizationId,
      connectionId,
      actorFromPrincipal(principal),
      extractRequestContext(req),
    );
    return toProviderConnectionResponse(refreshed);
  }
}
