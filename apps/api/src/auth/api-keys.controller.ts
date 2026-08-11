import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { MembershipRole, type ApiKey } from '@fraterunion-payments/database';
import type { RequestWithId } from '../common/types/request-with-id.type';
import { CurrentOrganizationContext } from './decorators/current-organization-context.decorator';
import { CurrentPrincipal } from './decorators/current-principal.decorator';
import { RequireRoles } from './decorators/require-roles.decorator';
import { ApiKeySummaryDto, CreateApiKeyResponseDto } from './dto/api-key-responses.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ActiveSessionGuard } from './guards/active-session.guard';
import { HumanJwtAuthGuard } from './guards/human-jwt-auth.guard';
import { OrganizationContextGuard } from './guards/organization-context.guard';
import { RequireRolesGuard } from './guards/require-roles.guard';
import { ApiKeyService } from './services/api-key.service';
import type { OrganizationContext } from './types/organization-context.type';
import type { UserPrincipal } from './types/principal.type';
import { extractRequestContext } from './utils/request-context.util';

function toApiKeySummary(apiKey: ApiKey): ApiKeySummaryDto {
  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    status: apiKey.status,
    environment: apiKey.environment,
    scopes: apiKey.scopes,
    lastUsedAt: apiKey.lastUsedAt,
    expiresAt: apiKey.expiresAt,
    revokedAt: apiKey.revokedAt,
    createdAt: apiKey.createdAt,
  };
}

/**
 * Managing API keys is itself a human, role-gated action — API keys
 * authenticate with scopes, but *creating/listing/revoking* them requires a
 * human session and an organization role. `DEVELOPER` may only create or
 * revoke `TEST`-environment keys (a documented policy choice, not a schema
 * constraint) — `OWNER`/`ADMIN` have no such restriction; `ANALYST`/
 * `SUPPORT` cannot reach this controller at all.
 */
@ApiTags('API Keys')
@ApiBearerAuth('bearer')
@Controller('api-keys')
@UseGuards(HumanJwtAuthGuard, ActiveSessionGuard, OrganizationContextGuard, RequireRolesGuard)
@RequireRoles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.DEVELOPER)
export class ApiKeysController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post()
  @ApiOkResponse({ type: CreateApiKeyResponseDto })
  async create(
    @Body() dto: CreateApiKeyDto,
    @CurrentPrincipal() principal: UserPrincipal,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
    @Req() req: RequestWithId,
  ): Promise<CreateApiKeyResponseDto> {
    if (organizationContext.role === MembershipRole.DEVELOPER && dto.environment === 'LIVE') {
      throw new ForbiddenException('DEVELOPER members may only create TEST-environment API keys.');
    }

    const created = await this.apiKeyService.create(
      {
        organizationId: organizationContext.organizationId,
        name: dto.name,
        environment: dto.environment,
        scopes: dto.scopes,
        createdByUserId: principal.userId,
        ...(dto.expiresAt !== undefined ? { expiresAt: new Date(dto.expiresAt) } : {}),
      },
      { type: 'user', userId: principal.userId },
      extractRequestContext(req),
    );

    return { key: created.plaintextKey, apiKey: toApiKeySummary(created.apiKey) };
  }

  @Get()
  @ApiOkResponse({ type: ApiKeySummaryDto, isArray: true })
  async list(
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
  ): Promise<ApiKeySummaryDto[]> {
    const apiKeys = await this.apiKeyService.list(organizationContext.organizationId);
    return apiKeys.map(toApiKeySummary);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: UserPrincipal,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
    @Req() req: RequestWithId,
  ): Promise<void> {
    if (organizationContext.role === MembershipRole.DEVELOPER) {
      const existing = await this.apiKeyService.findById(id, organizationContext.organizationId);
      if (existing !== null && existing.environment === 'LIVE') {
        throw new ForbiddenException(
          'DEVELOPER members may only revoke TEST-environment API keys.',
        );
      }
    }

    await this.apiKeyService.revoke(
      id,
      organizationContext.organizationId,
      { type: 'user', userId: principal.userId },
      extractRequestContext(req),
    );
  }
}
