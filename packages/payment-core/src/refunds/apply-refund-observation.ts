import type { Money } from '../money/money.js';
import type { PaymentFailure } from '../payments/failure.js';
import {
  beginRefundProcessing,
  failRefund,
  REFUND_STATES,
  succeedRefund,
  type Refund,
  type RefundState,
} from './refund.js';

export const REFUND_OBSERVATION_OUTCOMES = {
  APPLIED: 'APPLIED',
  NOOP_ALREADY_CURRENT: 'NOOP_ALREADY_CURRENT',
  NOOP_STALE: 'NOOP_STALE',
  ANOMALY: 'ANOMALY',
} as const;

export type RefundProviderObservation = {
  readonly state: RefundState;
  readonly amount: Money;
  readonly failure?: PaymentFailure;
  readonly observedAt: Date;
};

export type RefundObservationApplication =
  | {
      readonly kind: 'APPLIED';
      readonly refund: Refund;
      readonly fromStatus: RefundState;
      readonly toStatus: RefundState;
    }
  | { readonly kind: 'NOOP_ALREADY_CURRENT'; readonly refund: Refund }
  | { readonly kind: 'NOOP_STALE'; readonly refund: Refund }
  | { readonly kind: 'ANOMALY'; readonly refund: Refund; readonly reason: string };

export function applyRefundProviderObservation(
  refund: Refund,
  observation: RefundProviderObservation,
): RefundObservationApplication {
  if (observation.amount.currency !== refund.amount.currency) {
    return { kind: 'ANOMALY', refund, reason: 'CURRENCY_MISMATCH' };
  }
  if (observation.amount.amount !== refund.amount.amount) {
    return { kind: 'ANOMALY', refund, reason: 'AMOUNT_MISMATCH' };
  }

  if (refund.status === observation.state) {
    return { kind: 'NOOP_ALREADY_CURRENT', refund };
  }

  if (refund.status === REFUND_STATES.SUCCEEDED) {
    return { kind: 'NOOP_STALE', refund };
  }

  if (refund.status === REFUND_STATES.FAILED) {
    if (observation.state === REFUND_STATES.SUCCEEDED) {
      return { kind: 'ANOMALY', refund, reason: 'CLOSED_STATE_CONTRADICTION' };
    }
    return { kind: 'NOOP_STALE', refund };
  }

  try {
    const fromStatus = refund.status;
    let next = refund;
    if (observation.state === REFUND_STATES.PROCESSING) {
      if (next.status === REFUND_STATES.CREATED) {
        next = beginRefundProcessing(next, observation.observedAt);
      }
    } else if (observation.state === REFUND_STATES.SUCCEEDED) {
      next = succeedRefund(next, observation.observedAt);
    } else if (observation.state === REFUND_STATES.FAILED) {
      if (observation.failure === undefined) {
        return { kind: 'ANOMALY', refund, reason: 'FAILED_WITHOUT_FAILURE' };
      }
      next = failRefund(next, observation.failure, observation.observedAt);
    } else {
      return { kind: 'NOOP_STALE', refund };
    }

    if (next.status === fromStatus) {
      return { kind: 'NOOP_ALREADY_CURRENT', refund: next };
    }
    return {
      kind: 'APPLIED',
      refund: next,
      fromStatus,
      toStatus: next.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OBSERVATION_CONFLICT';
    if (/Cannot /i.test(message)) {
      return { kind: 'ANOMALY', refund, reason: 'INCOMPARABLE_OBSERVATION' };
    }
    throw error;
  }
}
