import type { Refund as RefundRow, Prisma } from '@fraterunion-payments/database';
import {
  asOrganizationId,
  asPaymentId,
  asRefundId,
  createMoney,
  createPaymentFailure,
  REFUND_STATES,
  type Refund as DomainRefund,
} from '@fraterunion-payments/payment-core';
import { RefundValidationException } from './refund.exceptions';
import {
  toDomainRefundFailureCategory,
  toDomainRefundReason,
  toDomainRefundStatus,
  toPersistedRefundFailureCategory,
  toPersistedRefundReason,
  toPersistedRefundStatus,
} from './refund-status';

/**
 * Reconstructs a payment-core refund from a persisted row.
 * Metadata stays on the persistence/API layer.
 */
export function toDomainRefund(row: RefundRow): DomainRefund {
  const status = toDomainRefundStatus(row.status);
  if (status === REFUND_STATES.FAILED) {
    if (
      row.failureCategory === null ||
      row.failureMessage === null ||
      row.failureRetryable === null
    ) {
      throw new RefundValidationException('A FAILED refund must persist failure fields.');
    }
  } else if (
    row.failureCategory !== null ||
    row.failureCode !== null ||
    row.failureMessage !== null ||
    row.failureRetryable !== null
  ) {
    throw new RefundValidationException('Non-FAILED refunds cannot persist failure fields.');
  }

  const refund: DomainRefund = {
    id: asRefundId(row.id),
    paymentId: asPaymentId(row.paymentId),
    organizationId: asOrganizationId(row.organizationId),
    amount: createMoney(row.amount, row.currency),
    status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.reason !== null ? { reason: toDomainRefundReason(row.reason) } : {}),
    ...(status === REFUND_STATES.FAILED &&
    row.failureCategory !== null &&
    row.failureMessage !== null &&
    row.failureRetryable !== null
      ? {
          failure: createPaymentFailure({
            category: toDomainRefundFailureCategory(row.failureCategory),
            message: row.failureMessage,
            retryable: row.failureRetryable,
            ...(row.failureCode !== null ? { code: row.failureCode } : {}),
          }),
        }
      : {}),
  };

  return Object.freeze(refund);
}

export function toRefundPersistenceUpdate(refund: DomainRefund): Prisma.RefundUpdateInput {
  const failure = refund.failure;
  return {
    status: toPersistedRefundStatus(refund.status),
    currency: refund.amount.currency,
    amount: refund.amount.amount,
    reason: refund.reason !== undefined ? toPersistedRefundReason(refund.reason) : null,
    failureCategory:
      refund.status === REFUND_STATES.FAILED && failure !== undefined
        ? toPersistedRefundFailureCategory(failure.category)
        : null,
    failureCode:
      refund.status === REFUND_STATES.FAILED && failure?.code !== undefined ? failure.code : null,
    failureMessage:
      refund.status === REFUND_STATES.FAILED && failure !== undefined ? failure.message : null,
    failureRetryable:
      refund.status === REFUND_STATES.FAILED && failure !== undefined ? failure.retryable : null,
  };
}
