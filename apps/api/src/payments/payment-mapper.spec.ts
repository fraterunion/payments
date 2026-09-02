import {
  PaymentCaptureMethod,
  PaymentFailureCategory,
  PaymentStatus,
  type Payment,
} from '@fraterunion-payments/database';
import { PAYMENT_STATES } from '@fraterunion-payments/payment-core';
import { toDomainPayment, toPaymentPersistenceUpdate } from './payment-mapper';

function paymentRow(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '01934567-89ab-7cde-8f01-23456789abcd',
    organizationId: '01934567-89ab-7cde-8f01-23456789abce',
    customerId: null,
    status: PaymentStatus.CREATED,
    captureMethod: PaymentCaptureMethod.AUTOMATIC,
    currency: 'USD',
    requestedAmount: 12500n,
    authorizedAmount: 0n,
    capturedAmount: 0n,
    refundedAmount: 0n,
    failureCategory: null,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    description: 'Order',
    metadata: { source: 'test' },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('payment mapper', () => {
  it('rehydrates a created payment through payment-core types', () => {
    const domain = toDomainPayment(paymentRow());
    expect(domain.status).toBe(PAYMENT_STATES.CREATED);
    expect(domain.requestedAmount.amount).toBe(12500n);
    expect(domain.requestedAmount.currency).toBe('USD');
    expect(domain.authorizedAmount.amount).toBe(0n);
    expect(domain.failure).toBeUndefined();
  });

  it('round-trips FAILED failure fields and clears them for persistence of other states', () => {
    const failed = toDomainPayment(
      paymentRow({
        status: PaymentStatus.FAILED,
        failureCategory: PaymentFailureCategory.DECLINED,
        failureCode: 'card_declined',
        failureMessage: 'Declined',
        failureRetryable: false,
      }),
    );
    expect(failed.failure).toMatchObject({
      category: 'DECLINED',
      code: 'card_declined',
      message: 'Declined',
      retryable: false,
    });
    expect(toPaymentPersistenceUpdate(failed)).toMatchObject({
      status: PaymentStatus.FAILED,
      failureCategory: PaymentFailureCategory.DECLINED,
      failureMessage: 'Declined',
    });
  });

  it('rejects a FAILED row without failure data', () => {
    expect(() => toDomainPayment(paymentRow({ status: PaymentStatus.FAILED }))).toThrow(
      /failure fields/,
    );
  });
});
