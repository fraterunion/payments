import { Injectable } from '@nestjs/common';
import type { Payment as PaymentRow, Prisma } from '@fraterunion-payments/database';
import {
  applyAuthorization,
  applyCapture,
  asCustomerId,
  asOrganizationId,
  asPaymentId,
  attachPaymentMethod,
  beginAuthorization,
  beginCapture,
  cancelPayment,
  createMoney,
  createPayment,
  createPaymentFailure,
  failPayment,
  markRequiresPaymentMethod,
  PAYMENT_METHOD_TYPES,
  requireCustomerAction,
  resumeAuthorization,
} from '@fraterunion-payments/payment-core';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, type AuditActor } from '../audit/audit.types';
import type { RequestContext } from '../auth/types/request-context.type';
import { DatabaseService } from '../database/database.service';
import type { DatabaseClient } from '../database/database.types';
import { parseApiIdempotencyKey } from '../idempotency/idempotency';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { IDEMPOTENCY_RESOURCE_TYPES, IDEMPOTENCY_SCOPES } from '../idempotency/idempotency.types';
import { parsePositiveMinorUnitAmount } from './payment-amount';
import { paymentCreateFingerprint } from './payment-idempotency';
import { toDomainPayment, toPaymentPersistenceUpdate } from './payment-mapper';
import { assertSafePaymentMetadata } from './payment-metadata';
import { toDomainCaptureMethod, toPersistedPaymentStatus } from './payment-status';
import {
  PaymentConcurrencyConflictException,
  PaymentCustomerArchivedException,
  PaymentCustomerNotFoundException,
  PaymentNotFoundException,
  PaymentValidationException,
  isIdempotencyUnique,
  mapPaymentDomainError,
  mapPaymentPrismaError,
} from './payment.exceptions';
import {
  PAYMENT_DESCRIPTION_MAX_LENGTH,
  PAYMENT_FAILURE_CODE_MAX_LENGTH,
  PAYMENT_FAILURE_MESSAGE_MAX_LENGTH,
  PAYMENT_LIST_DEFAULT_LIMIT,
  PAYMENT_LIST_MAX_LIMIT,
  type CreatePaymentInput,
  type ListPaymentsQuery,
  type MarkFailedInput,
  type PaymentListCursor,
} from './payment.types';

export type PaymentListResult = {
  readonly items: readonly PaymentRow[];
  readonly nextCursor: PaymentListCursor | undefined;
};

type TransactionClient = Prisma.TransactionClient;

/**
 * Tenant-scoped payment writes. Organization is always an explicit
 * argument. Mutations and audit share one transaction. Payment outbox
 * events are deferred: the production worker has no payment consumer
 * and would dead-letter unknown `payment.*` types.
 *
 * Public HTTP exposes create/get/list only. Lifecycle methods are
 * service-internal for future provider orchestration, webhooks, and
 * reconciliation — not client-callable status assignment.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly logger: PinoLogger,
    private readonly idempotency: IdempotencyService,
  ) {
    this.logger.setContext(PaymentsService.name);
  }

  async create(
    input: CreatePaymentInput,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<PaymentRow> {
    const { keyHash } = parseApiIdempotencyKey(input.idempotencyKey);
    const requestedAmount = parsePositiveMinorUnitAmount(input.amount);
    const description =
      input.description === undefined ? undefined : canonicalizeDescription(input.description);
    const metadata = assertSafePaymentMetadata(input.metadata ?? {});
    let domainDraft;
    try {
      domainDraft = createPayment({
        id: asPaymentId('00000000-0000-4000-8000-000000000001'),
        organizationId: asOrganizationId(input.organizationId),
        requestedAmount: createMoney(requestedAmount, input.currency),
        captureMethod: toDomainCaptureMethod(input.captureMethod),
        ...(input.customerId !== undefined ? { customerId: asCustomerId(input.customerId) } : {}),
      });
    } catch (error) {
      throw mapPaymentDomainError(error) ?? error;
    }
    const fingerprint = paymentCreateFingerprint({
      organizationId: input.organizationId,
      requestedAmount,
      currency: domainDraft.requestedAmount.currency,
      captureMethod: input.captureMethod,
      metadata,
      ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
      ...(description !== undefined ? { description } : {}),
    });

    const existing = await this.idempotency.resolveReplay(this.databaseService.getClient(), {
      organizationId: input.organizationId,
      scope: IDEMPOTENCY_SCOPES.PAYMENT_CREATE,
      keyHash,
      requestFingerprint: fingerprint,
    });
    if (existing !== undefined) {
      return this.get(input.organizationId, existing.resourceId);
    }

    const db = this.databaseService.getClient();
    try {
      return await db.$transaction(async (tx) => {
        if (input.customerId !== undefined) {
          await this.assertCustomerAcceptsPayment(tx, input.organizationId, input.customerId);
        }

        const created = await tx.payment.create({
          data: {
            organizationId: input.organizationId,
            status: toPersistedPaymentStatus(domainDraft.status),
            captureMethod: input.captureMethod,
            currency: domainDraft.requestedAmount.currency,
            requestedAmount: domainDraft.requestedAmount.amount,
            authorizedAmount: 0n,
            capturedAmount: 0n,
            refundedAmount: 0n,
            metadata: metadata as Prisma.InputJsonValue,
            ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
            ...(description !== undefined ? { description } : {}),
          },
        });

        await this.idempotency.bindCompleted(tx, {
          organizationId: input.organizationId,
          scope: IDEMPOTENCY_SCOPES.PAYMENT_CREATE,
          keyHash,
          requestFingerprint: fingerprint,
          resourceType: IDEMPOTENCY_RESOURCE_TYPES.PAYMENT,
          resourceId: created.id,
        });

        await this.auditService.write(tx, {
          organizationId: input.organizationId,
          actor,
          action: AUDIT_ACTIONS.PAYMENT_CREATED,
          resource: { type: AUDIT_RESOURCE_TYPES.PAYMENT, id: created.id },
          metadata: safePaymentAuditMetadata(created),
          ...(requestContext !== undefined ? { requestContext } : {}),
        });

        this.logger.info(
          {
            organizationId: input.organizationId,
            paymentId: created.id,
            status: created.status,
            currency: created.currency,
          },
          'Payment created',
        );
        return created;
      });
    } catch (error) {
      const mappedDomain = mapPaymentDomainError(error);
      if (mappedDomain !== undefined) {
        throw mappedDomain;
      }
      if (isIdempotencyUnique(error)) {
        const replay = await this.idempotency.resolveReplay(this.databaseService.getClient(), {
          organizationId: input.organizationId,
          scope: IDEMPOTENCY_SCOPES.PAYMENT_CREATE,
          keyHash,
          requestFingerprint: fingerprint,
        });
        if (replay !== undefined) {
          return this.get(input.organizationId, replay.resourceId);
        }
        throw new PaymentConcurrencyConflictException();
      }
      throw mapPaymentPrismaError(error) ?? error;
    }
  }

  async get(organizationId: string, paymentId: string): Promise<PaymentRow> {
    const payment = await this.databaseService.getClient().payment.findFirst({
      where: { id: paymentId, organizationId },
    });
    if (payment === null) {
      throw new PaymentNotFoundException();
    }
    return payment;
  }

  async list(query: ListPaymentsQuery): Promise<PaymentListResult> {
    const limit = Math.min(
      Math.max(query.limit ?? PAYMENT_LIST_DEFAULT_LIMIT, 1),
      PAYMENT_LIST_MAX_LIMIT,
    );
    const items = await this.databaseService.getClient().payment.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.customerId !== undefined ? { customerId: query.customerId } : {}),
        ...(query.currency !== undefined ? { currency: query.currency } : {}),
        ...(query.captureMethod !== undefined ? { captureMethod: query.captureMethod } : {}),
        ...createdAtFilter(query),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor:
        hasMore && last !== undefined ? { createdAt: last.createdAt, id: last.id } : undefined,
    };
  }

  async markRequiresPaymentMethod(
    organizationId: string,
    paymentId: string,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<PaymentRow> {
    return this.transition(
      organizationId,
      paymentId,
      actor,
      AUDIT_ACTIONS.PAYMENT_REQUIRES_PAYMENT_METHOD,
      (payment) => markRequiresPaymentMethod(payment),
      requestContext,
    );
  }

  async beginAuthorization(
    organizationId: string,
    paymentId: string,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<PaymentRow> {
    return this.transition(
      organizationId,
      paymentId,
      actor,
      AUDIT_ACTIONS.PAYMENT_AUTHORIZATION_STARTED,
      (payment) => {
        const withMethod =
          payment.paymentMethod === undefined
            ? attachPaymentMethod(payment, {
                id: payment.id,
                type: PAYMENT_METHOD_TYPES.OTHER,
              })
            : payment;
        return beginAuthorization(withMethod);
      },
      requestContext,
    );
  }

  async markRequiresAction(
    organizationId: string,
    paymentId: string,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<PaymentRow> {
    return this.transition(
      organizationId,
      paymentId,
      actor,
      AUDIT_ACTIONS.PAYMENT_REQUIRES_ACTION,
      (payment) => requireCustomerAction(payment),
      requestContext,
    );
  }

  async resumeAuthorization(
    organizationId: string,
    paymentId: string,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<PaymentRow> {
    return this.transition(
      organizationId,
      paymentId,
      actor,
      AUDIT_ACTIONS.PAYMENT_AUTHORIZATION_RESUMED,
      (payment) => resumeAuthorization(payment),
      requestContext,
    );
  }

  async markAuthorized(
    organizationId: string,
    paymentId: string,
    authorizedAmount: bigint,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<PaymentRow> {
    return this.transition(
      organizationId,
      paymentId,
      actor,
      AUDIT_ACTIONS.PAYMENT_AUTHORIZED,
      (payment) =>
        applyAuthorization(
          payment,
          createMoney(authorizedAmount, payment.requestedAmount.currency),
        ),
      requestContext,
    );
  }

  async beginCapture(
    organizationId: string,
    paymentId: string,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<PaymentRow> {
    return this.transition(
      organizationId,
      paymentId,
      actor,
      AUDIT_ACTIONS.PAYMENT_CAPTURE_STARTED,
      (payment) => beginCapture(payment),
      requestContext,
    );
  }

  async markSucceeded(
    organizationId: string,
    paymentId: string,
    capturedAmount: bigint,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<PaymentRow> {
    return this.transition(
      organizationId,
      paymentId,
      actor,
      AUDIT_ACTIONS.PAYMENT_SUCCEEDED,
      (payment) =>
        applyCapture(payment, createMoney(capturedAmount, payment.requestedAmount.currency)),
      requestContext,
    );
  }

  async markFailed(
    organizationId: string,
    paymentId: string,
    failure: MarkFailedInput,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<PaymentRow> {
    const message = canonicalizeFailureMessage(failure.message);
    const code = failure.code === undefined ? undefined : canonicalizeFailureCode(failure.code);
    return this.transition(
      organizationId,
      paymentId,
      actor,
      AUDIT_ACTIONS.PAYMENT_FAILED,
      (payment) =>
        failPayment(
          payment,
          createPaymentFailure({
            category: failure.category,
            message,
            retryable: failure.retryable,
            ...(code !== undefined ? { code } : {}),
          }),
        ),
      requestContext,
    );
  }

  async cancelPayment(
    organizationId: string,
    paymentId: string,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<PaymentRow> {
    return this.transition(
      organizationId,
      paymentId,
      actor,
      AUDIT_ACTIONS.PAYMENT_CANCELED,
      (payment) => cancelPayment(payment),
      requestContext,
    );
  }

  private async transition(
    organizationId: string,
    paymentId: string,
    actor: AuditActor,
    action: string,
    apply: (payment: ReturnType<typeof toDomainPayment>) => ReturnType<typeof toDomainPayment>,
    requestContext?: RequestContext,
  ): Promise<PaymentRow> {
    const db = this.databaseService.getClient();
    try {
      return await db.$transaction(async (tx) => {
        const locked = await this.lockPayment(tx, organizationId, paymentId);
        const next = apply(toDomainPayment(locked));
        const updated = await tx.payment.update({
          where: { id: locked.id },
          data: toPaymentPersistenceUpdate(next),
        });
        await this.auditService.write(tx, {
          organizationId,
          actor,
          action,
          resource: { type: AUDIT_RESOURCE_TYPES.PAYMENT, id: updated.id },
          metadata: safePaymentAuditMetadata(updated),
          ...(requestContext !== undefined ? { requestContext } : {}),
        });
        this.logger.info(
          { organizationId, paymentId: updated.id, status: updated.status },
          'Payment transition persisted',
        );
        return updated;
      });
    } catch (error) {
      throw mapPaymentDomainError(error) ?? mapPaymentPrismaError(error) ?? error;
    }
  }

  private async lockPayment(
    tx: TransactionClient,
    organizationId: string,
    paymentId: string,
  ): Promise<PaymentRow> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM payments
      WHERE id = ${paymentId}::uuid AND organization_id = ${organizationId}::uuid
      FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new PaymentNotFoundException();
    }
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, organizationId },
    });
    if (payment === null) {
      throw new PaymentNotFoundException();
    }
    return payment;
  }

  private async assertCustomerAcceptsPayment(
    client: DatabaseClient | TransactionClient,
    organizationId: string,
    customerId: string,
  ): Promise<void> {
    const customer = await client.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true, status: true },
    });
    if (customer === null) {
      throw new PaymentCustomerNotFoundException();
    }
    if (customer.status === 'ARCHIVED') {
      throw new PaymentCustomerArchivedException();
    }
  }
}

export function safePaymentAuditMetadata(payment: PaymentRow): Record<string, unknown> {
  return {
    paymentId: payment.id,
    status: payment.status,
    currency: payment.currency,
    captureMethod: payment.captureMethod,
    requestedAmount: payment.requestedAmount.toString(10),
    authorizedAmount: payment.authorizedAmount.toString(10),
    capturedAmount: payment.capturedAmount.toString(10),
    refundedAmount: payment.refundedAmount.toString(10),
    customerPresent: payment.customerId !== null,
    ...(payment.failureCategory !== null ? { failureCategory: payment.failureCategory } : {}),
    ...(payment.failureCode !== null ? { failureCode: payment.failureCode } : {}),
  };
}

function canonicalizeDescription(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PaymentValidationException('Payment description, if present, must be non-empty.');
  }
  if (trimmed.length > PAYMENT_DESCRIPTION_MAX_LENGTH) {
    throw new PaymentValidationException(
      `Payment description must be at most ${PAYMENT_DESCRIPTION_MAX_LENGTH} characters.`,
    );
  }
  return trimmed;
}

function canonicalizeFailureMessage(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PaymentValidationException('Payment failure message is required.');
  }
  if (trimmed.length > PAYMENT_FAILURE_MESSAGE_MAX_LENGTH) {
    throw new PaymentValidationException(
      `Payment failure message must be at most ${PAYMENT_FAILURE_MESSAGE_MAX_LENGTH} characters.`,
    );
  }
  return trimmed;
}

function canonicalizeFailureCode(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PaymentValidationException('Payment failure code, if present, must be non-empty.');
  }
  if (trimmed.length > PAYMENT_FAILURE_CODE_MAX_LENGTH) {
    throw new PaymentValidationException(
      `Payment failure code must be at most ${PAYMENT_FAILURE_CODE_MAX_LENGTH} characters.`,
    );
  }
  return trimmed;
}

function createdAtFilter(query: ListPaymentsQuery): Prisma.PaymentWhereInput {
  const createdAt: Prisma.DateTimeFilter = {};
  if (query.createdAtFrom !== undefined) {
    createdAt.gte = query.createdAtFrom;
  }
  if (query.createdAtTo !== undefined) {
    createdAt.lte = query.createdAtTo;
  }

  const range = Object.keys(createdAt).length > 0 ? { createdAt } : {};
  if (query.cursor === undefined) {
    return range;
  }

  return {
    AND: [
      range,
      {
        OR: [
          { createdAt: { lt: query.cursor.createdAt } },
          { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
        ],
      },
    ],
  };
}
