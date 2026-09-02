import {
  PaymentFailureCategory,
  RefundReason,
  RefundStatus,
  type Refund,
} from '@fraterunion-payments/database';
import { REFUND_STATES } from '@fraterunion-payments/payment-core';
import { toDomainRefund, toRefundPersistenceUpdate } from './refund-mapper';

function refundRow(overrides: Partial<Refund> = {}): Refund {
  return {
    id: '01934567-89ab-7cde-8f01-23456789abd0',
    organizationId: '01934567-89ab-7cde-8f01-23456789abce',
    paymentId: '01934567-89ab-7cde-8f01-23456789abcd',
    status: RefundStatus.CREATED,
    currency: 'USD',
    amount: 5000n,
    reason: RefundReason.CUSTOMER_REQUEST,
    failureCategory: null,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    metadata: { source: 'test' },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('refund mapper', () => {
  it('rehydrates a created refund through payment-core types', () => {
    const domain = toDomainRefund(refundRow());
    expect(domain.status).toBe(REFUND_STATES.CREATED);
    expect(domain.amount.amount).toBe(5000n);
    expect(domain.amount.currency).toBe('USD');
    expect(domain.reason).toBe('CUSTOMER_REQUEST');
    expect(domain.failure).toBeUndefined();
  });

  it('round-trips FAILED failure fields and clears them for other states', () => {
    const failed = toDomainRefund(
      refundRow({
        status: RefundStatus.FAILED,
        failureCategory: PaymentFailureCategory.PROVIDER,
        failureCode: 'refund_declined',
        failureMessage: 'Declined',
        failureRetryable: true,
      }),
    );
    expect(failed.failure).toMatchObject({
      category: 'PROVIDER',
      code: 'refund_declined',
      message: 'Declined',
      retryable: true,
    });
    expect(toRefundPersistenceUpdate(failed)).toMatchObject({
      status: RefundStatus.FAILED,
      failureCategory: PaymentFailureCategory.PROVIDER,
      failureMessage: 'Declined',
    });
  });

  it('rejects a FAILED row without failure data', () => {
    expect(() => toDomainRefund(refundRow({ status: RefundStatus.FAILED }))).toThrow(
      /failure fields/,
    );
  });
});
