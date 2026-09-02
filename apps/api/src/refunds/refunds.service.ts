import { Injectable } from '@nestjs/common';
import type {
  Payment as PaymentRow,
  Prisma,
  Refund as RefundRow,
} from '@fraterunion-payments/database';
import {
  applyRefund,
  asRefundId,
  beginRefundProcessing,
  createMoney,
  createPaymentFailure,
  createRefund,
  failRefund,
  isRefundablePaymentState,
  PAYMENT_STATES,
  succeedRefund,
} from '@fraterunion-payments/payment-core';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, type AuditActor } from '../audit/audit.types';
import type { RequestContext } from '../auth/types/request-context.type';
import { DatabaseService } from '../database/database.service';
import { canonicalizeIdempotencyKey, hashIdempotencyKey } from '../idempotency/idempotency';
import {
  IdempotencyKeyConflictException,
  isIdempotencyUnique,
} from '../idempotency/idempotency.exceptions';
import { IDEMPOTENCY_RESOURCE_TYPES } from '../idempotency/idempotency.types';
import { parsePositiveMinorUnitAmount } from '../payments/payment-amount';
import { toDomainPayment, toPaymentPersistenceUpdate } from '../payments/payment-mapper';
import { asBigInt, computeRefundCapacity, type RefundCapacitySnapshot } from './refund-capacity';
import { refundCreateFingerprint } from './refund-idempotency';
import { toDomainRefund, toRefundPersistenceUpdate } from './refund-mapper';
import { assertSafeRefundMetadata } from './refund-metadata';
import { toDomainRefundReason, toPersistedRefundStatus } from './refund-status';
import {
  PaymentNotRefundableException,
  RefundAmountExceedsAvailableException,
  RefundConcurrencyConflictException,
  RefundNotFoundException,
  RefundPaymentNotFoundException,
  RefundValidationException,
  mapRefundDomainError,
  mapRefundPrismaError,
} from './refund.exceptions';
import {
  REFUND_CREATE_IDEMPOTENCY_SCOPE,
  REFUND_FAILURE_CODE_MAX_LENGTH,
  REFUND_FAILURE_MESSAGE_MAX_LENGTH,
  REFUND_LIST_DEFAULT_LIMIT,
  REFUND_LIST_MAX_LIMIT,
  type CreateRefundInput,
  type ListRefundsQuery,
  type MarkRefundFailedInput,
  type RefundListCursor,
} from './refund.types';

export type RefundListResult = {
  readonly items: readonly RefundRow[];
  readonly nextCursor: RefundListCursor | undefined;
};

type TransactionClient = Prisma.TransactionClient;

type ReservationTotals = {
  readonly reserved: bigint;
  readonly inFlight: bigint;
};

/**
 * Tenant-scoped refund writes. Canonical lock order is Payment then Refund.
 * Mutations and audit share one transaction. Refund and payment-refund
 * outbox events are deferred.
 *
 * Public HTTP exposes create/get/list only. Lifecycle methods are
 * service-internal for future provider orchestration.
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RefundsService.name);
  }

  async create(
    input: CreateRefundInput,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<RefundRow> {
    const idempotencyKey = canonicalizeIdempotencyKey(input.idempotencyKey);
    const keyHash = hashIdempotencyKey(idempotencyKey);
    const amount = parsePositiveMinorUnitAmount(input.amount);
    const metadata = assertSafeRefundMetadata(input.metadata ?? {});
    const fingerprint = refundCreateFingerprint({
      organizationId: input.organizationId,
      paymentId: input.paymentId,
      amount,
      metadata,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    });

    const existing = await this.findIdempotentReplay(input.organizationId, keyHash, fingerprint);
    if (existing !== undefined) {
      return existing;
    }

    const db = this.databaseService.getClient();
    try {
      return await db.$transaction(async (tx) => {
        const payment = await this.lockPayment(tx, input.organizationId, input.paymentId);

        const replay = await this.findIdempotentReplayOn(
          tx,
          input.organizationId,
          keyHash,
          fingerprint,
        );
        if (replay !== undefined) {
          return replay;
        }

        const domainPayment = toDomainPayment(payment);
        if (!isRefundablePaymentState(domainPayment.status)) {
          throw new PaymentNotRefundableException();
        }

        const totals = await this.sumReservations(tx, input.organizationId, input.paymentId);
        const capacity = computeRefundCapacity({
          capturedAmount: payment.capturedAmount,
          successfulRefundedAmount: payment.refundedAmount,
          reservedRefundAmount: totals.reserved,
        });
        if (amount > capacity.availableRefundAmount) {
          throw new RefundAmountExceedsAvailableException();
        }

        let domainDraft;
        try {
          domainDraft = createRefund({
            id: asRefundId('00000000-0000-4000-8000-000000000001'),
            payment: domainPayment,
            amount: createMoney(amount, domainPayment.requestedAmount.currency),
            alreadyRefunded: domainPayment.refundedAmount,
            reservedRefunds: createMoney(totals.inFlight, domainPayment.requestedAmount.currency),
            ...(input.reason !== undefined ? { reason: toDomainRefundReason(input.reason) } : {}),
          });
        } catch (error) {
          throw mapRefundDomainError(error) ?? error;
        }

        const created = await tx.refund.create({
          data: {
            organizationId: input.organizationId,
            paymentId: input.paymentId,
            status: toPersistedRefundStatus(domainDraft.status),
            currency: domainDraft.amount.currency,
            amount: domainDraft.amount.amount,
            metadata: metadata as Prisma.InputJsonValue,
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
          },
        });

        await tx.idempotencyRecord.create({
          data: {
            organizationId: input.organizationId,
            scope: REFUND_CREATE_IDEMPOTENCY_SCOPE,
            keyHash,
            requestFingerprint: fingerprint,
            resourceType: IDEMPOTENCY_RESOURCE_TYPES.REFUND,
            resourceId: created.id,
          },
        });

        await this.auditService.write(tx, {
          organizationId: input.organizationId,
          actor,
          action: AUDIT_ACTIONS.REFUND_CREATED,
          resource: { type: AUDIT_RESOURCE_TYPES.REFUND, id: created.id },
          metadata: safeRefundAuditMetadata(created),
          ...(requestContext !== undefined ? { requestContext } : {}),
        });

        this.logger.info(
          {
            organizationId: input.organizationId,
            paymentId: created.paymentId,
            refundId: created.id,
            status: created.status,
          },
          'Refund created',
        );
        return created;
      });
    } catch (error) {
      const mappedDomain = mapRefundDomainError(error);
      if (mappedDomain !== undefined) {
        throw mappedDomain;
      }
      if (isRefundApplicationError(error)) {
        throw error;
      }
      if (isIdempotencyUnique(error)) {
        const replay = await this.findIdempotentReplay(input.organizationId, keyHash, fingerprint);
        if (replay !== undefined) {
          return replay;
        }
        throw new RefundConcurrencyConflictException();
      }
      throw mapRefundPrismaError(error) ?? error;
    }
  }

  async get(organizationId: string, refundId: string): Promise<RefundRow> {
    const refund = await this.databaseService.getClient().refund.findFirst({
      where: { id: refundId, organizationId },
    });
    if (refund === null) {
      throw new RefundNotFoundException();
    }
    return refund;
  }

  async list(query: ListRefundsQuery): Promise<RefundListResult> {
    if (query.paymentId !== undefined) {
      await this.assertPaymentExists(query.organizationId, query.paymentId);
    }
    const limit = Math.min(
      Math.max(query.limit ?? REFUND_LIST_DEFAULT_LIMIT, 1),
      REFUND_LIST_MAX_LIMIT,
    );
    const items = await this.databaseService.getClient().refund.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.paymentId !== undefined ? { paymentId: query.paymentId } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.reason !== undefined ? { reason: query.reason } : {}),
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

  async getRefundCapacity(
    organizationId: string,
    paymentId: string,
  ): Promise<RefundCapacitySnapshot> {
    const payment = await this.requirePayment(organizationId, paymentId);
    const totals = await this.sumReservations(
      this.databaseService.getClient(),
      organizationId,
      paymentId,
    );
    return computeRefundCapacity({
      capturedAmount: payment.capturedAmount,
      successfulRefundedAmount: payment.refundedAmount,
      reservedRefundAmount: totals.reserved,
    });
  }

  async beginRefundProcessing(
    organizationId: string,
    refundId: string,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<RefundRow> {
    return this.transitionRefund(
      organizationId,
      refundId,
      actor,
      AUDIT_ACTIONS.REFUND_PROCESSING_STARTED,
      (refund) => beginRefundProcessing(refund),
      requestContext,
    );
  }

  async succeedRefund(
    organizationId: string,
    refundId: string,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<RefundRow> {
    const db = this.databaseService.getClient();
    try {
      return await db.$transaction(async (tx) => {
        const hint = await this.requireRefundHint(tx, organizationId, refundId);
        const paymentRow = await this.lockPayment(tx, organizationId, hint.paymentId);
        const refundRow = await this.lockRefund(tx, organizationId, hint.paymentId, refundId);
        const nextRefund = succeedRefund(toDomainRefund(refundRow));
        const nextPayment = applyRefund(toDomainPayment(paymentRow), nextRefund.amount);
        const updatedRefund = await tx.refund.update({
          where: { id: refundRow.id },
          data: toRefundPersistenceUpdate(nextRefund),
        });
        const updatedPayment = await tx.payment.update({
          where: { id: paymentRow.id },
          data: toPaymentPersistenceUpdate(nextPayment),
        });
        await this.auditService.write(tx, {
          organizationId,
          actor,
          action: AUDIT_ACTIONS.REFUND_SUCCEEDED,
          resource: { type: AUDIT_RESOURCE_TYPES.REFUND, id: updatedRefund.id },
          metadata: {
            ...safeRefundAuditMetadata(updatedRefund),
            paymentRefundedAmount: updatedPayment.refundedAmount.toString(10),
            paymentStatus: updatedPayment.status,
          },
          ...(requestContext !== undefined ? { requestContext } : {}),
        });
        if (updatedPayment.status === PAYMENT_STATES.PARTIALLY_REFUNDED) {
          await this.auditService.write(tx, {
            organizationId,
            actor,
            action: AUDIT_ACTIONS.PAYMENT_PARTIALLY_REFUNDED,
            resource: { type: AUDIT_RESOURCE_TYPES.PAYMENT, id: updatedPayment.id },
            metadata: safePaymentRefundAuditMetadata(updatedPayment, updatedRefund.id),
            ...(requestContext !== undefined ? { requestContext } : {}),
          });
        }
        if (updatedPayment.status === PAYMENT_STATES.REFUNDED) {
          await this.auditService.write(tx, {
            organizationId,
            actor,
            action: AUDIT_ACTIONS.PAYMENT_REFUNDED,
            resource: { type: AUDIT_RESOURCE_TYPES.PAYMENT, id: updatedPayment.id },
            metadata: safePaymentRefundAuditMetadata(updatedPayment, updatedRefund.id),
            ...(requestContext !== undefined ? { requestContext } : {}),
          });
        }
        this.logger.info(
          {
            organizationId,
            paymentId: updatedPayment.id,
            refundId: updatedRefund.id,
            paymentStatus: updatedPayment.status,
          },
          'Refund succeeded',
        );
        return updatedRefund;
      });
    } catch (error) {
      throw mapRefundDomainError(error) ?? mapRefundPrismaError(error) ?? error;
    }
  }

  async failRefund(
    organizationId: string,
    refundId: string,
    failure: MarkRefundFailedInput,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<RefundRow> {
    const message = canonicalizeFailureMessage(failure.message);
    const code = failure.code === undefined ? undefined : canonicalizeFailureCode(failure.code);
    return this.transitionRefund(
      organizationId,
      refundId,
      actor,
      AUDIT_ACTIONS.REFUND_FAILED,
      (refund) =>
        failRefund(
          refund,
          createPaymentFailure({
            category: failure.category,
            message,
            retryable: failure.retryable,
            ...(code !== undefined ? { code } : {}),
          }),
        ),
      requestContext,
      (updated) => ({
        ...safeRefundAuditMetadata(updated),
        ...(updated.failureCategory !== null ? { failureCategory: updated.failureCategory } : {}),
        ...(updated.failureCode !== null ? { failureCode: updated.failureCode } : {}),
      }),
    );
  }

  private async transitionRefund(
    organizationId: string,
    refundId: string,
    actor: AuditActor,
    action: string,
    apply: (refund: ReturnType<typeof toDomainRefund>) => ReturnType<typeof toDomainRefund>,
    requestContext?: RequestContext,
    auditMetadata?: (refund: RefundRow) => Record<string, unknown>,
  ): Promise<RefundRow> {
    const db = this.databaseService.getClient();
    try {
      return await db.$transaction(async (tx) => {
        const hint = await this.requireRefundHint(tx, organizationId, refundId);
        await this.lockPayment(tx, organizationId, hint.paymentId);
        const locked = await this.lockRefund(tx, organizationId, hint.paymentId, refundId);
        const next = apply(toDomainRefund(locked));
        const updated = await tx.refund.update({
          where: { id: locked.id },
          data: toRefundPersistenceUpdate(next),
        });
        await this.auditService.write(tx, {
          organizationId,
          actor,
          action,
          resource: { type: AUDIT_RESOURCE_TYPES.REFUND, id: updated.id },
          metadata:
            auditMetadata !== undefined ? auditMetadata(updated) : safeRefundAuditMetadata(updated),
          ...(requestContext !== undefined ? { requestContext } : {}),
        });
        this.logger.info(
          { organizationId, refundId: updated.id, status: updated.status },
          'Refund transition persisted',
        );
        return updated;
      });
    } catch (error) {
      throw mapRefundDomainError(error) ?? mapRefundPrismaError(error) ?? error;
    }
  }

  /**
   * Lock order: Payment first. Callers that also need the refund must lock
   * the payment before `lockRefund`.
   */
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
      throw new RefundPaymentNotFoundException();
    }
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, organizationId },
    });
    if (payment === null) {
      throw new RefundPaymentNotFoundException();
    }
    return payment;
  }

  private async lockRefund(
    tx: TransactionClient,
    organizationId: string,
    paymentId: string,
    refundId: string,
  ): Promise<RefundRow> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM refunds
      WHERE id = ${refundId}::uuid
        AND organization_id = ${organizationId}::uuid
        AND payment_id = ${paymentId}::uuid
      FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new RefundNotFoundException();
    }
    const refund = await tx.refund.findFirst({
      where: { id: refundId, organizationId, paymentId },
    });
    if (refund === null) {
      throw new RefundNotFoundException();
    }
    return refund;
  }

  private async requireRefundHint(
    tx: TransactionClient,
    organizationId: string,
    refundId: string,
  ): Promise<Pick<RefundRow, 'id' | 'paymentId'>> {
    const refund = await tx.refund.findFirst({
      where: { id: refundId, organizationId },
      select: { id: true, paymentId: true },
    });
    if (refund === null) {
      throw new RefundNotFoundException();
    }
    return refund;
  }

  private async requirePayment(organizationId: string, paymentId: string): Promise<PaymentRow> {
    const payment = await this.databaseService.getClient().payment.findFirst({
      where: { id: paymentId, organizationId },
    });
    if (payment === null) {
      throw new RefundPaymentNotFoundException();
    }
    return payment;
  }

  private async assertPaymentExists(organizationId: string, paymentId: string): Promise<void> {
    await this.requirePayment(organizationId, paymentId);
  }

  private async sumReservations(
    client: TransactionClient | ReturnType<DatabaseService['getClient']>,
    organizationId: string,
    paymentId: string,
  ): Promise<ReservationTotals> {
    const rows = await client.$queryRaw<Array<{ reserved: unknown; in_flight: unknown }>>`
      SELECT
        COALESCE(SUM(amount) FILTER (
          WHERE status IN ('CREATED', 'PROCESSING', 'SUCCEEDED')
        ), 0)::bigint AS reserved,
        COALESCE(SUM(amount) FILTER (
          WHERE status IN ('CREATED', 'PROCESSING')
        ), 0)::bigint AS in_flight
      FROM refunds
      WHERE payment_id = ${paymentId}::uuid
        AND organization_id = ${organizationId}::uuid
    `;
    const row = rows[0];
    return {
      reserved: asBigInt(row?.reserved ?? 0),
      inFlight: asBigInt(row?.in_flight ?? 0),
    };
  }

  private async findIdempotentReplay(
    organizationId: string,
    keyHash: string,
    fingerprint: string,
  ): Promise<RefundRow | undefined> {
    return this.findIdempotentReplayOn(
      this.databaseService.getClient(),
      organizationId,
      keyHash,
      fingerprint,
    );
  }

  private async findIdempotentReplayOn(
    client: TransactionClient | ReturnType<DatabaseService['getClient']>,
    organizationId: string,
    keyHash: string,
    fingerprint: string,
  ): Promise<RefundRow | undefined> {
    const record = await client.idempotencyRecord.findUnique({
      where: {
        organizationId_scope_keyHash: {
          organizationId,
          scope: REFUND_CREATE_IDEMPOTENCY_SCOPE,
          keyHash,
        },
      },
    });
    if (record === null) {
      return undefined;
    }
    if (record.requestFingerprint !== fingerprint) {
      throw new IdempotencyKeyConflictException();
    }
    return this.getFrom(client, organizationId, record.resourceId);
  }

  private async getFrom(
    client: TransactionClient | ReturnType<DatabaseService['getClient']>,
    organizationId: string,
    refundId: string,
  ): Promise<RefundRow> {
    const refund = await client.refund.findFirst({
      where: { id: refundId, organizationId },
    });
    if (refund === null) {
      throw new RefundNotFoundException();
    }
    return refund;
  }
}

export function safeRefundAuditMetadata(refund: RefundRow): Record<string, unknown> {
  return {
    refundId: refund.id,
    paymentId: refund.paymentId,
    status: refund.status,
    currency: refund.currency,
    amount: refund.amount.toString(10),
    ...(refund.reason !== null ? { reason: refund.reason } : {}),
  };
}

export function safePaymentRefundAuditMetadata(
  payment: PaymentRow,
  refundId: string,
): Record<string, unknown> {
  return {
    paymentId: payment.id,
    refundId,
    status: payment.status,
    currency: payment.currency,
    capturedAmount: payment.capturedAmount.toString(10),
    refundedAmount: payment.refundedAmount.toString(10),
  };
}

function canonicalizeFailureMessage(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new RefundValidationException('Refund failure message is required.');
  }
  if (trimmed.length > REFUND_FAILURE_MESSAGE_MAX_LENGTH) {
    throw new RefundValidationException(
      `Refund failure message must be at most ${REFUND_FAILURE_MESSAGE_MAX_LENGTH} characters.`,
    );
  }
  return trimmed;
}

function canonicalizeFailureCode(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new RefundValidationException('Refund failure code, if present, must be non-empty.');
  }
  if (trimmed.length > REFUND_FAILURE_CODE_MAX_LENGTH) {
    throw new RefundValidationException(
      `Refund failure code must be at most ${REFUND_FAILURE_CODE_MAX_LENGTH} characters.`,
    );
  }
  return trimmed;
}

function createdAtFilter(query: ListRefundsQuery): Prisma.RefundWhereInput {
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

function isRefundApplicationError(error: unknown): boolean {
  return (
    error instanceof PaymentNotRefundableException ||
    error instanceof RefundAmountExceedsAvailableException ||
    error instanceof RefundNotFoundException ||
    error instanceof RefundPaymentNotFoundException ||
    error instanceof RefundValidationException ||
    error instanceof IdempotencyKeyConflictException
  );
}
