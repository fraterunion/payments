import { describe, expect, it } from 'vitest';
import {
  assertPaymentTransition,
  canTransitionPayment,
  isPaymentExecutionTerminal,
  isPaymentLifecycleClosed,
  isRefundablePaymentState,
  PAYMENT_STATES,
  PAYMENT_TRANSITIONS,
  type PaymentState,
} from './payment-states.js';

const ALL_STATES = Object.values(PAYMENT_STATES);

const ALLOWED: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  CREATED: ['REQUIRES_PAYMENT_METHOD', 'AUTHORIZING'],
  REQUIRES_PAYMENT_METHOD: ['AUTHORIZING'],
  AUTHORIZING: ['REQUIRES_ACTION', 'AUTHORIZED', 'CAPTURING', 'FAILED'],
  REQUIRES_ACTION: ['AUTHORIZING', 'FAILED'],
  AUTHORIZED: ['CAPTURING', 'CANCELED', 'FAILED'],
  CAPTURING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  FAILED: [],
  CANCELED: [],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  REFUNDED: [],
};

describe('payment transitions', () => {
  it.each(ALL_STATES)('enumerates allowed and rejected targets from %s', (from) => {
    const allowed = new Set(ALLOWED[from]);
    for (const to of ALL_STATES) {
      expect(canTransitionPayment(from, to)).toBe(allowed.has(to));
      if (allowed.has(to)) {
        expect(() => assertPaymentTransition(from, to)).not.toThrow();
      } else {
        expect(() => assertPaymentTransition(from, to)).toThrowError(/cannot transition/);
      }
    }
  });

  it('matches the documented matrix exactly', () => {
    expect(PAYMENT_TRANSITIONS).toEqual(ALLOWED);
  });

  it('rejects representative illegal transitions', () => {
    expect(() => assertPaymentTransition('CREATED', 'REFUNDED')).toThrow();
    expect(() => assertPaymentTransition('FAILED', 'SUCCEEDED')).toThrow();
    expect(() => assertPaymentTransition('REFUNDED', 'CAPTURING')).toThrow();
    expect(() => assertPaymentTransition('CANCELED', 'AUTHORIZED')).toThrow();
    expect(() => assertPaymentTransition('PARTIALLY_REFUNDED', 'AUTHORIZING')).toThrow();
  });

  it('distinguishes execution-terminal, refundable, and closed states', () => {
    expect(isPaymentExecutionTerminal('SUCCEEDED')).toBe(true);
    expect(isPaymentExecutionTerminal('AUTHORIZING')).toBe(false);
    expect(isRefundablePaymentState('SUCCEEDED')).toBe(true);
    expect(isRefundablePaymentState('PARTIALLY_REFUNDED')).toBe(true);
    expect(isRefundablePaymentState('FAILED')).toBe(false);
    expect(isPaymentLifecycleClosed('FAILED')).toBe(true);
    expect(isPaymentLifecycleClosed('CANCELED')).toBe(true);
    expect(isPaymentLifecycleClosed('REFUNDED')).toBe(true);
    expect(isPaymentLifecycleClosed('SUCCEEDED')).toBe(false);
  });
});
