import { DOMAIN_ERROR_CODES, InvalidRefundError } from '../errors/errors.js';
import type { OrganizationId, PaymentId, RefundId } from '../ids/ids.js';
import { assertSameCurrency, createMoney, type Money } from '../money/money.js';
import type { PaymentFailure } from '../payments/failure.js';
import type { Payment } from '../payments/payment.js';

export const REFUND_STATES = {
  CREATED: 'CREATED',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
} as const;

export type RefundState = (typeof REFUND_STATES)[keyof typeof REFUND_STATES];

/**
 * Normalized refund reason. Not a copy of any provider enum.
 * `CANCELED` is not a refund state: once submitted, a refund is
 * processing, succeeded, or failed.
 */
export const REFUND_REASONS = {
  CUSTOMER_REQUEST: 'CUSTOMER_REQUEST',
  DUPLICATE: 'DUPLICATE',
  FRAUDULENT: 'FRAUDULENT',
  PRODUCT_OR_SERVICE: 'PRODUCT_OR_SERVICE',
  OTHER: 'OTHER',
} as const;

export type RefundReason = (typeof REFUND_REASONS)[keyof typeof REFUND_REASONS];

export type Refund = {
  readonly id: RefundId;
  readonly paymentId: PaymentId;
  readonly organizationId: OrganizationId;
  readonly amount: Money;
  readonly status: RefundState;
  readonly reason?: RefundReason;
  readonly failure?: PaymentFailure;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

const REFUND_REASON_SET: ReadonlySet<string> = new Set(Object.values(REFUND_REASONS));

export type CreateRefundInput = {
  readonly id: RefundId;
  readonly payment: Payment;
  readonly amount: Money;
  readonly reason?: RefundReason;
  /**
   * Successful refunds already applied to the payment.
   */
  readonly alreadyRefunded?: Money;
  /**
   * In-flight refunds reserved against captured funds. The core cannot
   * prevent concurrent database over-refunds; persistence must enforce
   * that later.
   */
  readonly reservedRefunds?: Money;
  readonly createdAt?: Date;
};

function nowOr(value: Date | undefined): Date {
  return value === undefined ? new Date() : value;
}

export function assertRefundFitsCaptured(input: {
  readonly captured: Money;
  readonly alreadyRefunded: Money;
  readonly reserved: Money;
  readonly incoming: Money;
}): void {
  assertSameCurrency(input.captured, input.alreadyRefunded);
  assertSameCurrency(input.captured, input.reserved);
  assertSameCurrency(input.captured, input.incoming);
  const committed = input.alreadyRefunded.amount + input.reserved.amount + input.incoming.amount;
  if (committed > input.captured.amount) {
    throw new InvalidRefundError(
      'Successful plus reserved refunds cannot exceed capturedAmount.',
      DOMAIN_ERROR_CODES.REFUND_EXCEEDS_CAPTURED_AMOUNT,
    );
  }
}

export function createRefund(input: CreateRefundInput): Refund {
  if (input.amount.amount <= 0n) {
    throw new InvalidRefundError(
      'Refund amount must be greater than zero.',
      DOMAIN_ERROR_CODES.ZERO_AMOUNT_NOT_ALLOWED,
    );
  }
  assertSameCurrency(
    input.payment.requestedAmount,
    input.amount,
    'Refund currency must match the payment.',
  );

  if (input.reason !== undefined && !REFUND_REASON_SET.has(input.reason)) {
    throw new InvalidRefundError('Refund reason is not recognized.');
  }

  const alreadyRefunded = input.alreadyRefunded ?? input.payment.refundedAmount;
  const reserved = input.reservedRefunds ?? createMoney(0n, input.amount.currency);
  assertRefundFitsCaptured({
    captured: input.payment.capturedAmount,
    alreadyRefunded,
    reserved,
    incoming: input.amount,
  });

  const createdAt = nowOr(input.createdAt);
  return Object.freeze({
    id: input.id,
    paymentId: input.payment.id,
    organizationId: input.payment.organizationId,
    amount: input.amount,
    status: REFUND_STATES.CREATED,
    createdAt,
    updatedAt: createdAt,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  });
}

export function beginRefundProcessing(refund: Refund, occurredAt?: Date): Refund {
  if (refund.status !== REFUND_STATES.CREATED) {
    throw new InvalidRefundError(`Cannot begin processing a refund in state ${refund.status}.`);
  }
  return Object.freeze({
    ...refund,
    status: REFUND_STATES.PROCESSING,
    updatedAt: nowOr(occurredAt),
  });
}

export function succeedRefund(refund: Refund, occurredAt?: Date): Refund {
  if (refund.status !== REFUND_STATES.CREATED && refund.status !== REFUND_STATES.PROCESSING) {
    throw new InvalidRefundError(`Cannot succeed a refund in state ${refund.status}.`);
  }
  return Object.freeze({
    ...refund,
    status: REFUND_STATES.SUCCEEDED,
    updatedAt: nowOr(occurredAt),
  });
}

export function failRefund(refund: Refund, failure: PaymentFailure, occurredAt?: Date): Refund {
  if (refund.status !== REFUND_STATES.CREATED && refund.status !== REFUND_STATES.PROCESSING) {
    throw new InvalidRefundError(`Cannot fail a refund in state ${refund.status}.`);
  }
  return Object.freeze({
    ...refund,
    status: REFUND_STATES.FAILED,
    failure,
    updatedAt: nowOr(occurredAt),
  });
}
