import type { Payment as PaymentRow, Prisma } from '@fraterunion-payments/database';
import {
  asCustomerId,
  asOrganizationId,
  asPaymentId,
  createMoney,
  createPaymentFailure,
  PAYMENT_STATES,
  type Payment as DomainPayment,
} from '@fraterunion-payments/payment-core';
import { PaymentValidationException } from './payment.exceptions';
import { serializeMinorUnitAmount } from './payment-amount';
import {
  toDomainCaptureMethod,
  toDomainFailureCategory,
  toDomainPaymentStatus,
  toPersistedCaptureMethod,
  toPersistedFailureCategory,
  toPersistedPaymentStatus,
} from './payment-status';

/**
 * Reconstructs a payment-core aggregate from a persisted row.
 * Description and metadata stay on the persistence/API layer.
 */
export function toDomainPayment(row: PaymentRow): DomainPayment {
  const currency = row.currency;
  const requestedAmount = createMoney(row.requestedAmount, currency);
  const authorizedAmount = createMoney(row.authorizedAmount, currency);
  const capturedAmount = createMoney(row.capturedAmount, currency);
  const refundedAmount = createMoney(row.refundedAmount, currency);
  const status = toDomainPaymentStatus(row.status);

  if (status === PAYMENT_STATES.FAILED) {
    if (
      row.failureCategory === null ||
      row.failureMessage === null ||
      row.failureRetryable === null
    ) {
      throw new PaymentValidationException('A FAILED payment must persist failure fields.');
    }
  } else if (
    row.failureCategory !== null ||
    row.failureCode !== null ||
    row.failureMessage !== null ||
    row.failureRetryable !== null
  ) {
    throw new PaymentValidationException('Non-FAILED payments cannot persist failure fields.');
  }

  const payment: DomainPayment = {
    id: asPaymentId(row.id),
    organizationId: asOrganizationId(row.organizationId),
    status,
    captureMethod: toDomainCaptureMethod(row.captureMethod),
    requestedAmount,
    authorizedAmount,
    capturedAmount,
    refundedAmount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.customerId !== null ? { customerId: asCustomerId(row.customerId) } : {}),
    ...(status === PAYMENT_STATES.FAILED &&
    row.failureCategory !== null &&
    row.failureMessage !== null &&
    row.failureRetryable !== null
      ? {
          failure: createPaymentFailure({
            category: toDomainFailureCategory(row.failureCategory),
            message: row.failureMessage,
            retryable: row.failureRetryable,
            ...(row.failureCode !== null ? { code: row.failureCode } : {}),
          }),
        }
      : {}),
  };

  return Object.freeze(payment);
}

export function toPaymentPersistenceUpdate(payment: DomainPayment): Prisma.PaymentUpdateInput {
  const failure = payment.failure;
  return {
    status: toPersistedPaymentStatus(payment.status),
    captureMethod: toPersistedCaptureMethod(payment.captureMethod),
    currency: payment.requestedAmount.currency,
    requestedAmount: payment.requestedAmount.amount,
    authorizedAmount: payment.authorizedAmount.amount,
    capturedAmount: payment.capturedAmount.amount,
    refundedAmount: payment.refundedAmount.amount,
    failureCategory:
      payment.status === PAYMENT_STATES.FAILED && failure !== undefined
        ? toPersistedFailureCategory(failure.category)
        : null,
    failureCode:
      payment.status === PAYMENT_STATES.FAILED && failure?.code !== undefined ? failure.code : null,
    failureMessage:
      payment.status === PAYMENT_STATES.FAILED && failure !== undefined ? failure.message : null,
    failureRetryable:
      payment.status === PAYMENT_STATES.FAILED && failure !== undefined ? failure.retryable : null,
  };
}

export function serializePaymentAmounts(payment: DomainPayment): {
  requestedAmount: string;
  authorizedAmount: string;
  capturedAmount: string;
  refundedAmount: string;
} {
  return {
    requestedAmount: serializeMinorUnitAmount(payment.requestedAmount.amount),
    authorizedAmount: serializeMinorUnitAmount(payment.authorizedAmount.amount),
    capturedAmount: serializeMinorUnitAmount(payment.capturedAmount.amount),
    refundedAmount: serializeMinorUnitAmount(payment.refundedAmount.amount),
  };
}
