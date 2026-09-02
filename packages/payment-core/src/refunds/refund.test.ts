import { describe, expect, it } from 'vitest';
import { asOrganizationId, asPaymentId, asRefundId } from '../ids/ids.js';
import { createMoney } from '../money/money.js';
import { CAPTURE_METHODS } from '../payments/capture-method.js';
import { createPaymentFailure, PAYMENT_FAILURE_CATEGORIES } from '../payments/failure.js';
import {
  applyAuthorization,
  applyCapture,
  beginAuthorization,
  createPayment,
} from '../payments/payment.js';
import { createPaymentMethodReference } from '../payments/payment-method.js';
import {
  assertRefundFitsCaptured,
  beginRefundProcessing,
  createRefund,
  failRefund,
  REFUND_REASONS,
  succeedRefund,
} from './refund.js';

const payment = applyCapture(
  applyAuthorization(
    beginAuthorization(
      createPayment({
        id: asPaymentId('01934567-89ab-7cde-8f01-23456789abcd'),
        organizationId: asOrganizationId('01934567-89ab-7cde-8f01-23456789abce'),
        requestedAmount: createMoney(5000n, 'EUR'),
        captureMethod: CAPTURE_METHODS.AUTOMATIC,
        paymentMethod: createPaymentMethodReference({ id: 'pm_1', type: 'CARD' }),
      }),
    ),
    createMoney(5000n, 'EUR'),
  ),
  createMoney(5000n, 'EUR'),
);

describe('Refund', () => {
  it('creates CREATED refunds and transitions processing → succeeded/failed', () => {
    const refund = createRefund({
      id: asRefundId('01934567-89ab-7cde-8f01-23456789abcf'),
      payment,
      amount: createMoney(1500n, 'EUR'),
      reason: REFUND_REASONS.CUSTOMER_REQUEST,
    });
    expect(refund.status).toBe('CREATED');
    expect(refund.paymentId).toBe(payment.id);
    expect(succeedRefund(beginRefundProcessing(refund)).status).toBe('SUCCEEDED');
    expect(
      failRefund(
        beginRefundProcessing(refund),
        createPaymentFailure({
          category: PAYMENT_FAILURE_CATEGORIES.PROVIDER,
          message: 'Refund rejected',
          retryable: true,
        }),
      ).status,
    ).toBe('FAILED');
  });

  it('rejects zero, currency mismatch, and over-refund including reserved amounts', () => {
    expect(() =>
      createRefund({
        id: asRefundId('01934567-89ab-7cde-8f01-23456789abcf'),
        payment,
        amount: createMoney(0n, 'EUR'),
      }),
    ).toThrow(/greater than zero/);
    expect(() =>
      createRefund({
        id: asRefundId('01934567-89ab-7cde-8f01-23456789abcf'),
        payment,
        amount: createMoney(100n, 'USD'),
      }),
    ).toThrow(/must match the payment/);
    expect(() =>
      createRefund({
        id: asRefundId('01934567-89ab-7cde-8f01-23456789abcf'),
        payment,
        amount: createMoney(2000n, 'EUR'),
        alreadyRefunded: createMoney(4000n, 'EUR'),
        reservedRefunds: createMoney(500n, 'EUR'),
      }),
    ).toThrow(/cannot exceed capturedAmount/);
  });

  it('documents reserved+succeeded capacity as a helper, not a concurrency lock', () => {
    expect(() =>
      assertRefundFitsCaptured({
        captured: createMoney(100n, 'USD'),
        alreadyRefunded: createMoney(40n, 'USD'),
        reserved: createMoney(40n, 'USD'),
        incoming: createMoney(30n, 'USD'),
      }),
    ).toThrow(/cannot exceed capturedAmount/);
    expect(() =>
      assertRefundFitsCaptured({
        captured: createMoney(100n, 'USD'),
        alreadyRefunded: createMoney(40n, 'USD'),
        reserved: createMoney(40n, 'USD'),
        incoming: createMoney(20n, 'USD'),
      }),
    ).not.toThrow();
  });
});
