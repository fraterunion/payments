import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { MembershipRole, type Refund } from '@fraterunion-payments/database';
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
import { serializeMinorUnitAmount } from '../payments/payment-amount';
import { CreateRefundDto } from './dto/create-refund.dto';
import { ListRefundsQueryDto } from './dto/list-refunds.dto';
import { RefundListResponseDto, RefundResponseDto } from './dto/refund-responses.dto';
import { RefundValidationException } from './refund.exceptions';
import { RefundsService } from './refunds.service';

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

export function toRefundResponse(refund: Refund): RefundResponseDto {
  return {
    id: refund.id,
    paymentId: refund.paymentId,
    status: refund.status,
    currency: refund.currency,
    amount: serializeMinorUnitAmount(refund.amount),
    reason: refund.reason,
    failure:
      refund.status === 'FAILED' &&
      refund.failureCategory !== null &&
      refund.failureMessage !== null &&
      refund.failureRetryable !== null
        ? {
            category: refund.failureCategory,
            message: refund.failureMessage,
            retryable: refund.failureRetryable,
            ...(refund.failureCode !== null ? { code: refund.failureCode } : {}),
          }
        : null,
    metadata: (refund.metadata ?? {}) as Record<string, unknown>,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
  };
}

export function parseRefundCursor(
  createdAt: string | undefined,
  id: string | undefined,
): { createdAt: Date; id: string } | undefined {
  if (createdAt === undefined && id === undefined) {
    return undefined;
  }
  if (createdAt === undefined || id === undefined) {
    throw new RefundValidationException('Cursor requires both cursorCreatedAt and cursorId.');
  }
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new RefundValidationException('cursorCreatedAt must be a valid timestamp.');
  }
  return { createdAt: parsed, id };
}

@ApiTags('Refunds')
@ApiBearerAuth('bearer')
@ApiSecurity('apiKey')
@Controller('payments/:paymentId/refunds')
@UseGuards(
  EitherAuthGuard,
  ActiveSessionGuard,
  OrganizationContextGuard,
  RequireRolesGuard,
  RequireScopesGuard,
)
export class PaymentRefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Post()
  @RequireRoles(...WRITE_ROLES)
  @RequireScopes('refunds:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: RefundResponseDto })
  async create(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: CreateRefundDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: Principal,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
    @Req() req: RequestWithId,
  ): Promise<RefundResponseDto> {
    const created = await this.refundsService.create(
      {
        ...dto,
        organizationId: organizationContext.organizationId,
        paymentId,
        idempotencyKey: idempotencyKey ?? '',
      },
      actorFromPrincipal(principal),
      extractRequestContext(req),
    );
    return toRefundResponse(created);
  }

  @Get()
  @RequireRoles(...READ_ROLES)
  @RequireScopes('refunds:read')
  @ApiOkResponse({ type: RefundListResponseDto })
  async list(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Query() query: ListRefundsQueryDto,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
  ): Promise<RefundListResponseDto> {
    const cursor = parseRefundCursor(query.cursorCreatedAt, query.cursorId);
    const result = await this.refundsService.list({
      organizationId: organizationContext.organizationId,
      paymentId,
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.reason !== undefined ? { reason: query.reason } : {}),
      ...(query.createdAtFrom !== undefined
        ? { createdAtFrom: new Date(query.createdAtFrom) }
        : {}),
      ...(query.createdAtTo !== undefined ? { createdAtTo: new Date(query.createdAtTo) } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    return {
      items: result.items.map(toRefundResponse),
      nextCursor: result.nextCursor,
    };
  }
}

@ApiTags('Refunds')
@ApiBearerAuth('bearer')
@ApiSecurity('apiKey')
@Controller('refunds')
@UseGuards(
  EitherAuthGuard,
  ActiveSessionGuard,
  OrganizationContextGuard,
  RequireRolesGuard,
  RequireScopesGuard,
)
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Get()
  @RequireRoles(...READ_ROLES)
  @RequireScopes('refunds:read')
  @ApiOkResponse({ type: RefundListResponseDto })
  async list(
    @Query() query: ListRefundsQueryDto,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
  ): Promise<RefundListResponseDto> {
    const cursor = parseRefundCursor(query.cursorCreatedAt, query.cursorId);
    const result = await this.refundsService.list({
      organizationId: organizationContext.organizationId,
      ...(query.paymentId !== undefined ? { paymentId: query.paymentId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.reason !== undefined ? { reason: query.reason } : {}),
      ...(query.createdAtFrom !== undefined
        ? { createdAtFrom: new Date(query.createdAtFrom) }
        : {}),
      ...(query.createdAtTo !== undefined ? { createdAtTo: new Date(query.createdAtTo) } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    return {
      items: result.items.map(toRefundResponse),
      nextCursor: result.nextCursor,
    };
  }

  @Get(':refundId')
  @RequireRoles(...READ_ROLES)
  @RequireScopes('refunds:read')
  @ApiOkResponse({ type: RefundResponseDto })
  async get(
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
  ): Promise<RefundResponseDto> {
    const refund = await this.refundsService.get(organizationContext.organizationId, refundId);
    return toRefundResponse(refund);
  }
}
