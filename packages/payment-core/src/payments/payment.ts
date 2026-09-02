import { DOMAIN_ERROR_CODES, PaymentInvariantError } from '../errors/errors.js';
import type { CustomerId, OrganizationId, PaymentId } from '../ids/ids.js';
import { assertSameCurrency, createMoney, type Money, zeroMoney } from '../money/money.js';
import { CAPTURE_METHODS, type CaptureMethod } from './capture-method.js';
import type { PaymentFailure } from './failure.js';
import type { PaymentMethodReference } from './payment-method.js';
import {
  assertPaymentTransition,
  isRefundablePaymentState,
  PAYMENT_STATES,
  type PaymentState,
} from './payment-states.js';

export type Payment = {
  readonly id: PaymentId;
  readonly organizationId: OrganizationId;
  readonly customerId?: CustomerId;
  readonly status: PaymentState;
  readonly captureMethod: CaptureMethod;
  readonly requestedAmount: Money;
  readonly authorizedAmount: Money;
  readonly capturedAmount: Money;
  readonly refundedAmount: Money;
  readonly paymentMethod?: PaymentMethodReference;
  readonly failure?: PaymentFailure;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type CreatePaymentInput = {
  readonly id: PaymentId;
  readonly organizationId: OrganizationId;
  readonly requestedAmount: Money;
  readonly captureMethod: CaptureMethod;
  readonly customerId?: CustomerId;
  readonly paymentMethod?: PaymentMethodReference;
  readonly createdAt?: Date;
};

function nowOr(value: Date | undefined): Date {
  return value === undefined ? new Date() : value;
}

function assertPositivePaymentAmount(amount: Money, label: string): void {
  if (amount.amount <= 0n) {
    throw new PaymentInvariantError(
      `${label} must be greater than zero.`,
      DOMAIN_ERROR_CODES.ZERO_AMOUNT_NOT_ALLOWED,
    );
  }
}

function assertMonetaryInvariant(payment: Payment): void {
  const { requestedAmount, authorizedAmount, capturedAmount, refundedAmount } = payment;
  assertSameCurrency(requestedAmount, authorizedAmount);
  assertSameCurrency(requestedAmount, capturedAmount);
  assertSameCurrency(requestedAmount, refundedAmount);

  if (refundedAmount.amount < 0n || capturedAmount.amount < 0n || authorizedAmount.amount < 0n) {
    throw new PaymentInvariantError('Payment amounts cannot be negative.');
  }
  if (refundedAmount.amount > capturedAmount.amount) {
    throw new PaymentInvariantError(
      'refundedAmount cannot exceed capturedAmount.',
      DOMAIN_ERROR_CODES.REFUND_EXCEEDS_CAPTURED_AMOUNT,
    );
  }
  if (capturedAmount.amount > authorizedAmount.amount) {
    throw new PaymentInvariantError(
      'capturedAmount cannot exceed authorizedAmount.',
      DOMAIN_ERROR_CODES.CAPTURE_EXCEEDS_AUTHORIZED_AMOUNT,
    );
  }
  if (authorizedAmount.amount > requestedAmount.amount) {
    throw new PaymentInvariantError(
      'authorizedAmount cannot exceed requestedAmount.',
      DOMAIN_ERROR_CODES.AUTHORIZATION_EXCEEDS_REQUESTED_AMOUNT,
    );
  }
}

function freezePayment(payment: Payment): Payment {
  assertMonetaryInvariant(payment);
  return Object.freeze(payment);
}

function withStatus(payment: Payment, status: PaymentState, occurredAt: Date): Payment {
  assertPaymentTransition(payment.status, status);
  return freezePayment({
    ...payment,
    status,
    updatedAt: occurredAt,
  });
}

export function createPayment(input: CreatePaymentInput): Payment {
  assertPositivePaymentAmount(input.requestedAmount, 'requestedAmount');
  const createdAt = nowOr(input.createdAt);
  return freezePayment({
    id: input.id,
    organizationId: input.organizationId,
    status: PAYMENT_STATES.CREATED,
    captureMethod: input.captureMethod,
    requestedAmount: input.requestedAmount,
    authorizedAmount: zeroMoney(input.requestedAmount.currency),
    capturedAmount: zeroMoney(input.requestedAmount.currency),
    refundedAmount: zeroMoney(input.requestedAmount.currency),
    createdAt,
    updatedAt: createdAt,
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    ...(input.paymentMethod !== undefined ? { paymentMethod: input.paymentMethod } : {}),
  });
}

export function markRequiresPaymentMethod(payment: Payment, occurredAt?: Date): Payment {
  if (payment.paymentMethod !== undefined) {
    throw new PaymentInvariantError(
      'Payment already has a payment method.',
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_OPERATION,
    );
  }
  return withStatus(payment, PAYMENT_STATES.REQUIRES_PAYMENT_METHOD, nowOr(occurredAt));
}

export function attachPaymentMethod(
  payment: Payment,
  paymentMethod: PaymentMethodReference,
  occurredAt?: Date,
): Payment {
  if (
    payment.status !== PAYMENT_STATES.CREATED &&
    payment.status !== PAYMENT_STATES.REQUIRES_PAYMENT_METHOD
  ) {
    throw new PaymentInvariantError(
      `Cannot attach a payment method in state ${payment.status}.`,
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_OPERATION,
    );
  }
  return freezePayment({
    ...payment,
    paymentMethod,
    updatedAt: nowOr(occurredAt),
  });
}

export function canBeginAuthorization(payment: Payment): boolean {
  return (
    payment.paymentMethod !== undefined &&
    (payment.status === PAYMENT_STATES.CREATED ||
      payment.status === PAYMENT_STATES.REQUIRES_PAYMENT_METHOD)
  );
}

export function beginAuthorization(payment: Payment, occurredAt?: Date): Payment {
  if (payment.paymentMethod === undefined) {
    throw new PaymentInvariantError(
      'A payment method is required before authorization.',
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_OPERATION,
    );
  }
  return withStatus(payment, PAYMENT_STATES.AUTHORIZING, nowOr(occurredAt));
}

export function requireCustomerAction(payment: Payment, occurredAt?: Date): Payment {
  return withStatus(payment, PAYMENT_STATES.REQUIRES_ACTION, nowOr(occurredAt));
}

export function resumeAuthorization(payment: Payment, occurredAt?: Date): Payment {
  return withStatus(payment, PAYMENT_STATES.AUTHORIZING, nowOr(occurredAt));
}

/**
 * Stripe (and similar providers) may ask for another payment method on the
 * same execution after AUTHORIZING or REQUIRES_ACTION. This is not terminal
 * FAILED. Domain failure fields stay unset — persistence only stores
 * failure columns on FAILED.
 */
export function returnToRequiresPaymentMethod(payment: Payment, occurredAt?: Date): Payment {
  if (
    payment.status !== PAYMENT_STATES.AUTHORIZING &&
    payment.status !== PAYMENT_STATES.REQUIRES_ACTION
  ) {
    throw new PaymentInvariantError(
      `Cannot return to requires-payment-method in state ${payment.status}.`,
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_OPERATION,
    );
  }
  return withStatus(payment, PAYMENT_STATES.REQUIRES_PAYMENT_METHOD, nowOr(occurredAt));
}

export function canApplyAuthorization(payment: Payment): boolean {
  return payment.status === PAYMENT_STATES.AUTHORIZING;
}

export function applyAuthorization(
  payment: Payment,
  authorizedAmount: Money,
  occurredAt?: Date,
): Payment {
  if (!canApplyAuthorization(payment)) {
    throw new PaymentInvariantError(
      `Cannot apply authorization in state ${payment.status}.`,
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_OPERATION,
    );
  }
  assertSameCurrency(payment.requestedAmount, authorizedAmount);
  assertPositivePaymentAmount(authorizedAmount, 'authorizedAmount');
  if (authorizedAmount.amount > payment.requestedAmount.amount) {
    throw new PaymentInvariantError(
      'authorizedAmount cannot exceed requestedAmount.',
      DOMAIN_ERROR_CODES.AUTHORIZATION_EXCEEDS_REQUESTED_AMOUNT,
    );
  }

  const nextStatus =
    payment.captureMethod === CAPTURE_METHODS.AUTOMATIC
      ? PAYMENT_STATES.CAPTURING
      : PAYMENT_STATES.AUTHORIZED;

  assertPaymentTransition(payment.status, nextStatus);
  return freezePayment({
    ...payment,
    status: nextStatus,
    authorizedAmount,
    updatedAt: nowOr(occurredAt),
  });
}

export function canBeginCapture(payment: Payment): boolean {
  return (
    payment.status === PAYMENT_STATES.AUTHORIZED && remainingCapturableAmount(payment).amount > 0n
  );
}

export function beginCapture(payment: Payment, occurredAt?: Date): Payment {
  if (!canBeginCapture(payment)) {
    throw new PaymentInvariantError(
      `Cannot begin capture in state ${payment.status}.`,
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_OPERATION,
    );
  }
  return withStatus(payment, PAYMENT_STATES.CAPTURING, nowOr(occurredAt));
}

export function canApplyCapture(payment: Payment): boolean {
  return (
    payment.status === PAYMENT_STATES.CAPTURING && remainingCapturableAmount(payment).amount > 0n
  );
}

export function applyCapture(payment: Payment, captureAmount: Money, occurredAt?: Date): Payment {
  if (payment.status !== PAYMENT_STATES.CAPTURING) {
    throw new PaymentInvariantError(
      `Cannot apply capture in state ${payment.status}.`,
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_OPERATION,
    );
  }
  assertSameCurrency(payment.requestedAmount, captureAmount);
  assertPositivePaymentAmount(captureAmount, 'captureAmount');
  const remaining = remainingCapturableAmount(payment);
  if (captureAmount.amount > remaining.amount) {
    throw new PaymentInvariantError(
      'captureAmount cannot exceed remaining authorized amount.',
      DOMAIN_ERROR_CODES.CAPTURE_EXCEEDS_AUTHORIZED_AMOUNT,
    );
  }

  assertPaymentTransition(payment.status, PAYMENT_STATES.SUCCEEDED);
  return freezePayment({
    ...payment,
    status: PAYMENT_STATES.SUCCEEDED,
    capturedAmount: createMoney(
      payment.capturedAmount.amount + captureAmount.amount,
      payment.requestedAmount.currency,
    ),
    updatedAt: nowOr(occurredAt),
  });
}

export function canCancelPayment(payment: Payment): boolean {
  return (
    payment.status === PAYMENT_STATES.CREATED ||
    payment.status === PAYMENT_STATES.REQUIRES_PAYMENT_METHOD ||
    payment.status === PAYMENT_STATES.AUTHORIZING ||
    payment.status === PAYMENT_STATES.REQUIRES_ACTION ||
    payment.status === PAYMENT_STATES.AUTHORIZED
  );
}

export function cancelPayment(payment: Payment, occurredAt?: Date): Payment {
  if (!canCancelPayment(payment)) {
    throw new PaymentInvariantError(
      `Cannot cancel a payment in state ${payment.status}.`,
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_OPERATION,
    );
  }
  return withStatus(payment, PAYMENT_STATES.CANCELED, nowOr(occurredAt));
}

export function failPayment(payment: Payment, failure: PaymentFailure, occurredAt?: Date): Payment {
  const next = withStatus(payment, PAYMENT_STATES.FAILED, nowOr(occurredAt));
  return freezePayment({
    ...next,
    failure,
  });
}

export function canRefundPayment(payment: Payment): boolean {
  return isRefundablePaymentState(payment.status) && refundableAmount(payment).amount > 0n;
}

export function applyRefund(payment: Payment, refundAmount: Money, occurredAt?: Date): Payment {
  if (!isRefundablePaymentState(payment.status)) {
    throw new PaymentInvariantError(
      `Cannot refund a payment in state ${payment.status}.`,
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_OPERATION,
    );
  }
  assertSameCurrency(payment.requestedAmount, refundAmount);
  assertPositivePaymentAmount(refundAmount, 'refundAmount');
  const nextRefunded = payment.refundedAmount.amount + refundAmount.amount;
  if (nextRefunded > payment.capturedAmount.amount) {
    throw new PaymentInvariantError(
      'refundAmount cannot exceed remaining captured amount.',
      DOMAIN_ERROR_CODES.REFUND_EXCEEDS_CAPTURED_AMOUNT,
    );
  }

  const nextStatus = derivePaymentRefundState({
    executionState: payment.status,
    capturedAmount: payment.capturedAmount.amount,
    refundedAmount: nextRefunded,
  });

  assertPaymentTransition(payment.status, nextStatus);
  return freezePayment({
    ...payment,
    status: nextStatus,
    refundedAmount: createMoney(nextRefunded, payment.requestedAmount.currency),
    updatedAt: nowOr(occurredAt),
  });
}

export function remainingAuthorizedAmount(payment: Payment): Money {
  return createMoney(
    payment.authorizedAmount.amount - payment.capturedAmount.amount,
    payment.requestedAmount.currency,
  );
}

/**
 * Monetary leftover that could still be captured if the payment is in a
 * capturable execution state. After SUCCEEDED, additional captures are
 * not in the state machine even if authorized > captured.
 */
export function remainingCapturableAmount(payment: Payment): Money {
  if (payment.status !== PAYMENT_STATES.AUTHORIZED && payment.status !== PAYMENT_STATES.CAPTURING) {
    return zeroMoney(payment.requestedAmount.currency);
  }
  return remainingAuthorizedAmount(payment);
}

export function refundableAmount(payment: Payment): Money {
  if (!isRefundablePaymentState(payment.status)) {
    return zeroMoney(payment.requestedAmount.currency);
  }
  return createMoney(
    payment.capturedAmount.amount - payment.refundedAmount.amount,
    payment.requestedAmount.currency,
  );
}

export function isFullyCaptured(payment: Payment): boolean {
  return (
    payment.authorizedAmount.amount > 0n &&
    payment.capturedAmount.amount === payment.authorizedAmount.amount
  );
}

export function isPartiallyCaptured(payment: Payment): boolean {
  return (
    payment.capturedAmount.amount > 0n &&
    payment.capturedAmount.amount < payment.authorizedAmount.amount
  );
}

export function isPartiallyRefunded(payment: Payment): boolean {
  return (
    payment.refundedAmount.amount > 0n &&
    payment.refundedAmount.amount < payment.capturedAmount.amount
  );
}

export function isFullyRefunded(payment: Payment): boolean {
  return (
    payment.capturedAmount.amount > 0n &&
    payment.refundedAmount.amount === payment.capturedAmount.amount
  );
}

export function derivePaymentRefundState(input: {
  readonly executionState: PaymentState;
  readonly capturedAmount: bigint;
  readonly refundedAmount: bigint;
}): PaymentState {
  if (
    input.executionState !== PAYMENT_STATES.SUCCEEDED &&
    input.executionState !== PAYMENT_STATES.PARTIALLY_REFUNDED &&
    input.executionState !== PAYMENT_STATES.REFUNDED
  ) {
    if (input.refundedAmount > 0n) {
      throw new PaymentInvariantError(
        'Refund totals cannot be applied to a non-successful payment.',
        DOMAIN_ERROR_CODES.INVALID_PAYMENT_OPERATION,
      );
    }
    return input.executionState;
  }

  if (input.refundedAmount > input.capturedAmount) {
    throw new PaymentInvariantError(
      'refundedAmount cannot exceed capturedAmount.',
      DOMAIN_ERROR_CODES.REFUND_EXCEEDS_CAPTURED_AMOUNT,
    );
  }

  if (input.refundedAmount === 0n) {
    return PAYMENT_STATES.SUCCEEDED;
  }
  if (input.refundedAmount === input.capturedAmount) {
    return PAYMENT_STATES.REFUNDED;
  }
  return PAYMENT_STATES.PARTIALLY_REFUNDED;
}
