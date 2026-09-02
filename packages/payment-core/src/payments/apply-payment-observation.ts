import { CAPTURE_METHODS } from './capture-method.js';
import { PAYMENT_METHOD_TYPES, createPaymentMethodReference } from './payment-method.js';
import {
  applyAuthorization,
  applyCapture,
  attachPaymentMethod,
  beginAuthorization,
  beginCapture,
  cancelPayment,
  failPayment,
  markRequiresPaymentMethod,
  requireCustomerAction,
  resumeAuthorization,
  returnToRequiresPaymentMethod,
  type Payment,
} from './payment.js';
import { PAYMENT_STATES, isPaymentLifecycleClosed, type PaymentState } from './payment-states.js';
import { createMoney, type Money } from '../money/money.js';
import type { PaymentFailure } from './failure.js';

export const PAYMENT_OBSERVATION_OUTCOMES = {
  APPLIED: 'APPLIED',
  NOOP_ALREADY_CURRENT: 'NOOP_ALREADY_CURRENT',
  NOOP_STALE: 'NOOP_STALE',
  ANOMALY: 'ANOMALY',
} as const;

export type PaymentObservationOutcomeKind =
  (typeof PAYMENT_OBSERVATION_OUTCOMES)[keyof typeof PAYMENT_OBSERVATION_OUTCOMES];

/**
 * Provider-neutral payment snapshot. Stripe event names never appear here.
 */
export type PaymentProviderObservation = {
  readonly state: PaymentState;
  readonly authorizedAmount?: Money;
  readonly capturedAmount?: Money;
  readonly failure?: PaymentFailure;
  readonly observedAt: Date;
};

export type PaymentObservationApplication =
  | {
      readonly kind: 'APPLIED';
      readonly payment: Payment;
      readonly fromStatus: PaymentState;
      readonly toStatus: PaymentState;
    }
  | {
      readonly kind: 'NOOP_ALREADY_CURRENT';
      readonly payment: Payment;
    }
  | {
      readonly kind: 'NOOP_STALE';
      readonly payment: Payment;
    }
  | {
      readonly kind: 'ANOMALY';
      readonly payment: Payment;
      readonly reason: string;
    };

const SUCCESS_FAMILY: ReadonlySet<PaymentState> = new Set([
  PAYMENT_STATES.SUCCEEDED,
  PAYMENT_STATES.PARTIALLY_REFUNDED,
  PAYMENT_STATES.REFUNDED,
]);

function amountsEconomicallyEqual(
  payment: Payment,
  observation: PaymentProviderObservation,
): boolean {
  const authorized = observation.authorizedAmount?.amount ?? payment.authorizedAmount.amount;
  const captured = observation.capturedAmount?.amount ?? payment.capturedAmount.amount;
  return (
    authorized === payment.authorizedAmount.amount && captured === payment.capturedAmount.amount
  );
}

function observationDecreasesMoney(
  payment: Payment,
  observation: PaymentProviderObservation,
): boolean {
  if (
    observation.authorizedAmount !== undefined &&
    observation.authorizedAmount.amount < payment.authorizedAmount.amount
  ) {
    return true;
  }
  if (
    observation.capturedAmount !== undefined &&
    observation.capturedAmount.amount < payment.capturedAmount.amount
  ) {
    return true;
  }
  return false;
}

function ensurePaymentMethod(payment: Payment): Payment {
  if (payment.paymentMethod !== undefined) {
    return payment;
  }
  return attachPaymentMethod(
    payment,
    createPaymentMethodReference({ id: payment.id, type: PAYMENT_METHOD_TYPES.OTHER }),
  );
}

function ensureAuthorizing(payment: Payment, occurredAt: Date): Payment {
  if (payment.status === PAYMENT_STATES.AUTHORIZING) {
    return payment;
  }
  if (payment.status === PAYMENT_STATES.REQUIRES_ACTION) {
    return resumeAuthorization(payment, occurredAt);
  }
  if (
    payment.status === PAYMENT_STATES.CREATED ||
    payment.status === PAYMENT_STATES.REQUIRES_PAYMENT_METHOD
  ) {
    return beginAuthorization(ensurePaymentMethod(payment), occurredAt);
  }
  return payment;
}

function applySucceeded(payment: Payment, observation: PaymentProviderObservation): Payment {
  const occurredAt = observation.observedAt;
  const captured = observation.capturedAmount;
  const authorized = observation.authorizedAmount ?? captured ?? payment.requestedAmount;
  let next = ensureAuthorizing(payment, occurredAt);
  if (next.status === PAYMENT_STATES.AUTHORIZING) {
    next = applyAuthorization(next, authorized, occurredAt);
  }
  if (next.status === PAYMENT_STATES.AUTHORIZED) {
    next = beginCapture(next, occurredAt);
  }
  if (next.status === PAYMENT_STATES.CAPTURING) {
    if (captured === undefined || captured.amount <= 0n) {
      throw new Error('SUCCEEDED observation is missing a positive captured amount.');
    }
    const increment = captured.amount - next.capturedAmount.amount;
    if (increment <= 0n) {
      throw new Error('SUCCEEDED observation is missing a positive captured amount.');
    }
    next = applyCapture(next, createMoney(increment, captured.currency), occurredAt);
  }
  return next;
}

/**
 * Advances a canonical Payment using a provider snapshot. Uses domain
 * transitions only. Fast-forwards missing intermediate webhooks.
 * Never regresses terminal success or closed failure/cancel.
 */
export function applyPaymentProviderObservation(
  payment: Payment,
  observation: PaymentProviderObservation,
): PaymentObservationApplication {
  const fromStatus = payment.status;

  if (observation.authorizedAmount !== undefined) {
    if (observation.authorizedAmount.currency !== payment.requestedAmount.currency) {
      return { kind: 'ANOMALY', payment, reason: 'CURRENCY_MISMATCH' };
    }
    if (observation.authorizedAmount.amount > payment.requestedAmount.amount) {
      return { kind: 'ANOMALY', payment, reason: 'AUTHORIZATION_EXCEEDS_REQUESTED' };
    }
  }
  if (observation.capturedAmount !== undefined) {
    if (observation.capturedAmount.currency !== payment.requestedAmount.currency) {
      return { kind: 'ANOMALY', payment, reason: 'CURRENCY_MISMATCH' };
    }
  }

  if (observationDecreasesMoney(payment, observation)) {
    return { kind: 'NOOP_STALE', payment };
  }

  if (payment.status === observation.state && amountsEconomicallyEqual(payment, observation)) {
    return { kind: 'NOOP_ALREADY_CURRENT', payment };
  }

  if (isPaymentLifecycleClosed(payment.status) && payment.status !== observation.state) {
    if (
      observation.state === PAYMENT_STATES.SUCCEEDED ||
      observation.state === PAYMENT_STATES.AUTHORIZED ||
      observation.state === PAYMENT_STATES.CAPTURING
    ) {
      return { kind: 'ANOMALY', payment, reason: 'CLOSED_STATE_CONTRADICTION' };
    }
    return { kind: 'NOOP_STALE', payment };
  }

  if (SUCCESS_FAMILY.has(payment.status) && !SUCCESS_FAMILY.has(observation.state)) {
    return { kind: 'NOOP_STALE', payment };
  }

  try {
    let next = payment;
    switch (observation.state) {
      case PAYMENT_STATES.REQUIRES_PAYMENT_METHOD:
        if (next.status === PAYMENT_STATES.CREATED) {
          next = markRequiresPaymentMethod(next, observation.observedAt);
        } else {
          next = returnToRequiresPaymentMethod(next, observation.observedAt);
        }
        break;
      case PAYMENT_STATES.REQUIRES_ACTION:
        next = ensureAuthorizing(next, observation.observedAt);
        if (next.status === PAYMENT_STATES.AUTHORIZING) {
          next = requireCustomerAction(next, observation.observedAt);
        }
        break;
      case PAYMENT_STATES.AUTHORIZING:
        next = ensureAuthorizing(next, observation.observedAt);
        break;
      case PAYMENT_STATES.AUTHORIZED: {
        if (next.captureMethod === CAPTURE_METHODS.AUTOMATIC) {
          return { kind: 'ANOMALY', payment, reason: 'AUTHORIZED_ON_AUTOMATIC_CAPTURE' };
        }
        const authorized = observation.authorizedAmount ?? next.requestedAmount;
        next = ensureAuthorizing(next, observation.observedAt);
        if (next.status === PAYMENT_STATES.AUTHORIZING) {
          next = applyAuthorization(next, authorized, observation.observedAt);
        }
        break;
      }
      case PAYMENT_STATES.CAPTURING: {
        next = ensureAuthorizing(next, observation.observedAt);
        if (next.status === PAYMENT_STATES.AUTHORIZING) {
          const authorized = observation.authorizedAmount ?? next.requestedAmount;
          next = applyAuthorization(next, authorized, observation.observedAt);
        }
        if (next.status === PAYMENT_STATES.AUTHORIZED) {
          next = beginCapture(next, observation.observedAt);
        }
        break;
      }
      case PAYMENT_STATES.SUCCEEDED:
        next = applySucceeded(next, observation);
        break;
      case PAYMENT_STATES.CANCELED:
        next = cancelPayment(next, observation.observedAt);
        break;
      case PAYMENT_STATES.FAILED:
        if (observation.failure === undefined) {
          return { kind: 'ANOMALY', payment, reason: 'FAILED_WITHOUT_FAILURE' };
        }
        next = failPayment(next, observation.failure, observation.observedAt);
        break;
      default:
        return { kind: 'NOOP_STALE', payment };
    }

    if (next.status === fromStatus && amountsEconomicallyEqual(next, observation)) {
      return { kind: 'NOOP_ALREADY_CURRENT', payment: next };
    }
    return {
      kind: 'APPLIED',
      payment: next,
      fromStatus,
      toStatus: next.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OBSERVATION_CONFLICT';
    if (/cannot transition|Cannot |missing a positive/i.test(message)) {
      return { kind: 'ANOMALY', payment, reason: 'INCOMPARABLE_OBSERVATION' };
    }
    throw error;
  }
}
