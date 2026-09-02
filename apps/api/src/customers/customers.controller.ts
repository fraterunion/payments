import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  MembershipRole,
  type Customer,
  type CustomerProviderMapping,
} from '@fraterunion-payments/database';
import { AuditActor } from '../audit/audit.types';
import { CurrentOrganizationContext } from '../auth/decorators/current-organization-context.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { RequireRoles } from '../auth/decorators/require-roles.decorator';
import { RequireScopes } from '../auth/decorators/require-scopes.decorator';
import { ActiveSessionGuard } from '../auth/guards/active-session.guard';
import { EitherAuthGuard } from '../auth/guards/either-auth.guard';
import { OrganizationContextGuard } from '../auth/guards/organization-context.guard';
import { RequireRolesGuard } from '../auth/guards/require-roles.guard';
import { RequireScopesGuard } from '../auth/guards/require-scopes.guard';
import type { OrganizationContext } from '../auth/types/organization-context.type';
import type { Principal } from '../auth/types/principal.type';
import { extractRequestContext } from '../auth/utils/request-context.util';
import type { RequestWithId } from '../common/types/request-with-id.type';
import { CustomerValidationException } from './customer.exceptions';
import { CustomerProviderMappingsService } from './customer-provider-mappings.service';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import {
  CustomerListResponseDto,
  CustomerResponseDto,
  ProviderMappingResponseDto,
} from './dto/customer-responses.dto';
import { ListCustomersQueryDto } from './dto/list-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const READ_ROLES = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.DEVELOPER,
  MembershipRole.ANALYST,
  MembershipRole.SUPPORT,
] as const;

const WRITE_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.DEVELOPER] as const;

function actorFromPrincipal(principal: Principal): AuditActor {
  if (principal.type === 'USER') {
    return { type: 'USER', userId: principal.userId };
  }
  return { type: 'API_KEY', apiKeyId: principal.apiKeyId };
}

function toCustomerResponse(customer: Customer): CustomerResponseDto {
  return {
    id: customer.id,
    type: customer.type,
    status: customer.status,
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    externalReference: customer.externalReference,
    description: customer.description,
    metadata: (customer.metadata ?? {}) as Record<string, unknown>,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    archivedAt: customer.archivedAt,
  };
}

function toMappingResponse(mapping: CustomerProviderMapping): ProviderMappingResponseDto {
  return {
    id: mapping.id,
    provider: mapping.provider,
    providerAccountReference: mapping.providerAccountReference,
    providerCustomerId: mapping.providerCustomerId,
    createdAt: mapping.createdAt,
  };
}

@ApiTags('Customers')
@ApiBearerAuth('bearer')
@ApiSecurity('apiKey')
@Controller('customers')
@UseGuards(
  EitherAuthGuard,
  ActiveSessionGuard,
  OrganizationContextGuard,
  RequireRolesGuard,
  RequireScopesGuard,
)
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly mappingsService: CustomerProviderMappingsService,
  ) {}

  @Post()
  @RequireRoles(...WRITE_ROLES)
  @RequireScopes('customers:write')
  @ApiOkResponse({ type: CustomerResponseDto })
  async create(
    @Body() dto: CreateCustomerDto,
    @CurrentPrincipal() principal: Principal,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
    @Req() req: RequestWithId,
  ): Promise<CustomerResponseDto> {
    const created = await this.customersService.create(
      { ...dto, organizationId: organizationContext.organizationId },
      actorFromPrincipal(principal),
      extractRequestContext(req),
    );
    return toCustomerResponse(created);
  }

  @Get()
  @RequireRoles(...READ_ROLES)
  @RequireScopes('customers:read')
  @ApiOkResponse({ type: CustomerListResponseDto })
  async list(
    @Query() query: ListCustomersQueryDto,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
  ): Promise<CustomerListResponseDto> {
    const cursor = parseCursor(query.cursorCreatedAt, query.cursorId);
    const result = await this.customersService.list({
      organizationId: organizationContext.organizationId,
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    return {
      items: result.items.map(toCustomerResponse),
      nextCursor: result.nextCursor,
    };
  }

  @Get(':customerId')
  @RequireRoles(...READ_ROLES)
  @RequireScopes('customers:read')
  @ApiOkResponse({ type: CustomerResponseDto })
  async get(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
  ): Promise<CustomerResponseDto> {
    const customer = await this.customersService.get(
      organizationContext.organizationId,
      customerId,
    );
    return toCustomerResponse(customer);
  }

  @Patch(':customerId')
  @RequireRoles(...WRITE_ROLES)
  @RequireScopes('customers:write')
  @ApiOkResponse({ type: CustomerResponseDto })
  async update(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentPrincipal() principal: Principal,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
    @Req() req: RequestWithId,
  ): Promise<CustomerResponseDto> {
    const updated = await this.customersService.update(
      organizationContext.organizationId,
      customerId,
      dto,
      actorFromPrincipal(principal),
      extractRequestContext(req),
    );
    return toCustomerResponse(updated);
  }

  @Post(':customerId/archive')
  @RequireRoles(...WRITE_ROLES)
  @RequireScopes('customers:write')
  @ApiOkResponse({ type: CustomerResponseDto })
  async archive(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @CurrentPrincipal() principal: Principal,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
    @Req() req: RequestWithId,
  ): Promise<CustomerResponseDto> {
    const archived = await this.customersService.archive(
      organizationContext.organizationId,
      customerId,
      actorFromPrincipal(principal),
      extractRequestContext(req),
    );
    return toCustomerResponse(archived);
  }

  @Get(':customerId/provider-mappings')
  @RequireRoles(...READ_ROLES)
  @RequireScopes('customers:read')
  @ApiOkResponse({ type: ProviderMappingResponseDto, isArray: true })
  async listMappings(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
  ): Promise<ProviderMappingResponseDto[]> {
    const mappings = await this.mappingsService.listForCustomer(
      organizationContext.organizationId,
      customerId,
    );
    return mappings.map(toMappingResponse);
  }
}

function parseCursor(
  createdAt: string | undefined,
  id: string | undefined,
): { createdAt: Date; id: string } | undefined {
  if (createdAt === undefined && id === undefined) {
    return undefined;
  }
  if (createdAt === undefined || id === undefined) {
    throw new CustomerValidationException('Cursor requires both cursorCreatedAt and cursorId.');
  }
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new CustomerValidationException('cursorCreatedAt must be a valid timestamp.');
  }
  return { createdAt: parsed, id };
}
