import { InvalidPaymentTransitionError } from '../errors/errors.js';

export const PAYMENT_STATES = {
  CREATED: 'CREATED',
  REQUIRES_PAYMENT_METHOD: 'REQUIRES_PAYMENT_METHOD',
  REQUIRES_ACTION: 'REQUIRES_ACTION',
  AUTHORIZING: 'AUTHORIZING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURING: 'CAPTURING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
} as const;

export type PaymentState = (typeof PAYMENT_STATES)[keyof typeof PAYMENT_STATES];

/**
 * Allowed next states from each state. Matches
 * `docs/architecture/payment-lifecycle.md`.
 */
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  CREATED: [
    PAYMENT_STATES.REQUIRES_PAYMENT_METHOD,
    PAYMENT_STATES.AUTHORIZING,
    PAYMENT_STATES.CANCELED,
  ],
  REQUIRES_PAYMENT_METHOD: [PAYMENT_STATES.AUTHORIZING, PAYMENT_STATES.CANCELED],
  AUTHORIZING: [
    PAYMENT_STATES.REQUIRES_PAYMENT_METHOD,
    PAYMENT_STATES.REQUIRES_ACTION,
    PAYMENT_STATES.AUTHORIZED,
    PAYMENT_STATES.CAPTURING,
    PAYMENT_STATES.FAILED,
    PAYMENT_STATES.CANCELED,
  ],
  REQUIRES_ACTION: [
    PAYMENT_STATES.AUTHORIZING,
    PAYMENT_STATES.REQUIRES_PAYMENT_METHOD,
    PAYMENT_STATES.FAILED,
    PAYMENT_STATES.CANCELED,
  ],
  AUTHORIZED: [PAYMENT_STATES.CAPTURING, PAYMENT_STATES.CANCELED, PAYMENT_STATES.FAILED],
  CAPTURING: [PAYMENT_STATES.SUCCEEDED, PAYMENT_STATES.FAILED],
  SUCCEEDED: [PAYMENT_STATES.PARTIALLY_REFUNDED, PAYMENT_STATES.REFUNDED],
  FAILED: [],
  CANCELED: [],
  PARTIALLY_REFUNDED: [PAYMENT_STATES.PARTIALLY_REFUNDED, PAYMENT_STATES.REFUNDED],
  REFUNDED: [],
};

export function canTransitionPayment(from: PaymentState, to: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

export function assertPaymentTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransitionPayment(from, to)) {
    throw new InvalidPaymentTransitionError(`Payment cannot transition from ${from} to ${to}.`);
  }
}

/** No further authorize/capture operations. Refunds may still apply. */
export function isPaymentExecutionTerminal(state: PaymentState): boolean {
  return (
    state === PAYMENT_STATES.SUCCEEDED ||
    state === PAYMENT_STATES.FAILED ||
    state === PAYMENT_STATES.CANCELED ||
    state === PAYMENT_STATES.PARTIALLY_REFUNDED ||
    state === PAYMENT_STATES.REFUNDED
  );
}

export function isRefundablePaymentState(state: PaymentState): boolean {
  return state === PAYMENT_STATES.SUCCEEDED || state === PAYMENT_STATES.PARTIALLY_REFUNDED;
}

/** Failed/canceled/fully refunded: a new payment is required. */
export function isPaymentLifecycleClosed(state: PaymentState): boolean {
  return (
    state === PAYMENT_STATES.FAILED ||
    state === PAYMENT_STATES.CANCELED ||
    state === PAYMENT_STATES.REFUNDED
  );
}
