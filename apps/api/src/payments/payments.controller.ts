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
import { MembershipRole, type Payment } from '@fraterunion-payments/database';
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
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments.dto';
import { PaymentListResponseDto, PaymentResponseDto } from './dto/payment-responses.dto';
import { serializeMinorUnitAmount } from './payment-amount';
import { PaymentValidationException } from './payment.exceptions';
import { PaymentsService } from './payments.service';

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

export function toPaymentResponse(payment: Payment): PaymentResponseDto {
  return {
    id: payment.id,
    customerId: payment.customerId,
    status: payment.status,
    captureMethod: payment.captureMethod,
    currency: payment.currency,
    requestedAmount: serializeMinorUnitAmount(payment.requestedAmount),
    authorizedAmount: serializeMinorUnitAmount(payment.authorizedAmount),
    capturedAmount: serializeMinorUnitAmount(payment.capturedAmount),
    refundedAmount: serializeMinorUnitAmount(payment.refundedAmount),
    failure:
      payment.status === 'FAILED' &&
      payment.failureCategory !== null &&
      payment.failureMessage !== null &&
      payment.failureRetryable !== null
        ? {
            category: payment.failureCategory,
            message: payment.failureMessage,
            retryable: payment.failureRetryable,
            ...(payment.failureCode !== null ? { code: payment.failureCode } : {}),
          }
        : null,
    description: payment.description,
    metadata: (payment.metadata ?? {}) as Record<string, unknown>,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

@ApiTags('Payments')
@ApiBearerAuth('bearer')
@ApiSecurity('apiKey')
@Controller('payments')
@UseGuards(
  EitherAuthGuard,
  ActiveSessionGuard,
  OrganizationContextGuard,
  RequireRolesGuard,
  RequireScopesGuard,
)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @RequireRoles(...WRITE_ROLES)
  @RequireScopes('payments:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: PaymentResponseDto })
  async create(
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: Principal,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
    @Req() req: RequestWithId,
  ): Promise<PaymentResponseDto> {
    const created = await this.paymentsService.create(
      {
        ...dto,
        organizationId: organizationContext.organizationId,
        idempotencyKey: idempotencyKey ?? '',
      },
      actorFromPrincipal(principal),
      extractRequestContext(req),
    );
    return toPaymentResponse(created);
  }

  @Get()
  @RequireRoles(...READ_ROLES)
  @RequireScopes('payments:read')
  @ApiOkResponse({ type: PaymentListResponseDto })
  async list(
    @Query() query: ListPaymentsQueryDto,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
  ): Promise<PaymentListResponseDto> {
    const cursor = parseCursor(query.cursorCreatedAt, query.cursorId);
    const result = await this.paymentsService.list({
      organizationId: organizationContext.organizationId,
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.customerId !== undefined ? { customerId: query.customerId } : {}),
      ...(query.currency !== undefined ? { currency: query.currency.toUpperCase() } : {}),
      ...(query.captureMethod !== undefined ? { captureMethod: query.captureMethod } : {}),
      ...(query.createdAtFrom !== undefined
        ? { createdAtFrom: new Date(query.createdAtFrom) }
        : {}),
      ...(query.createdAtTo !== undefined ? { createdAtTo: new Date(query.createdAtTo) } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    return {
      items: result.items.map(toPaymentResponse),
      nextCursor: result.nextCursor,
    };
  }

  @Get(':paymentId')
  @RequireRoles(...READ_ROLES)
  @RequireScopes('payments:read')
  @ApiOkResponse({ type: PaymentResponseDto })
  async get(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentOrganizationContext() organizationContext: OrganizationContext,
  ): Promise<PaymentResponseDto> {
    const payment = await this.paymentsService.get(organizationContext.organizationId, paymentId);
    return toPaymentResponse(payment);
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
    throw new PaymentValidationException('Cursor requires both cursorCreatedAt and cursorId.');
  }
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new PaymentValidationException('cursorCreatedAt must be a valid timestamp.');
  }
  return { createdAt: parsed, id };
}
