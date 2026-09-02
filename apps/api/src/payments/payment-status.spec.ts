import {
  PaymentCaptureMethod,
  PaymentFailureCategory,
  PaymentStatus,
} from '@fraterunion-payments/database';
import {
  CAPTURE_METHODS,
  PAYMENT_FAILURE_CATEGORIES,
  PAYMENT_STATES,
} from '@fraterunion-payments/payment-core';
import {
  domainPaymentStates,
  persistedPaymentStates,
  toDomainCaptureMethod,
  toDomainFailureCategory,
  toDomainPaymentStatus,
  toPersistedCaptureMethod,
  toPersistedFailureCategory,
  toPersistedPaymentStatus,
} from './payment-status';

describe('payment status alignment', () => {
  it('maps every payment-core state to Prisma and back', () => {
    const domain = [...domainPaymentStates()].sort();
    const persisted = [...persistedPaymentStates()].sort();
    expect(domain).toEqual(Object.values(PAYMENT_STATES).sort());
    expect(persisted).toEqual(Object.values(PaymentStatus).sort());
    expect(domain).toEqual(persisted);

    for (const state of domain) {
      expect(toDomainPaymentStatus(toPersistedPaymentStatus(state))).toBe(state);
    }
  });

  it('maps capture methods and failure categories without drift', () => {
    expect(Object.values(CAPTURE_METHODS).sort()).toEqual(
      Object.values(PaymentCaptureMethod).sort(),
    );
    expect(Object.values(PAYMENT_FAILURE_CATEGORIES).sort()).toEqual(
      Object.values(PaymentFailureCategory).sort(),
    );
    for (const method of Object.values(CAPTURE_METHODS)) {
      expect(toDomainCaptureMethod(toPersistedCaptureMethod(method))).toBe(method);
    }
    for (const category of Object.values(PAYMENT_FAILURE_CATEGORIES)) {
      expect(toDomainFailureCategory(toPersistedFailureCategory(category))).toBe(category);
    }
  });
});
