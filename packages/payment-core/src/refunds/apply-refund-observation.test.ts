import { describe, expect, it } from 'vitest';
import { asOrganizationId, asPaymentId, asRefundId } from '../ids/ids.js';
import { createMoney } from '../money/money.js';
import { createPaymentFailure, PAYMENT_FAILURE_CATEGORIES } from '../payments/failure.js';
import { applyRefundProviderObservation } from './apply-refund-observation.js';
import { beginRefundProcessing, createRefund, succeedRefund } from './refund.js';
import { CAPTURE_METHODS } from '../payments/capture-method.js';
import { createPaymentMethodReference } from '../payments/payment-method.js';
import {
  applyAuthorization,
  applyCapture,
  beginAuthorization,
  createPayment,
} from '../payments/payment.js';

const NOW = new Date('2026-09-02T18:00:00.000Z');
const FAILURE = createPaymentFailure({
  category: PAYMENT_FAILURE_CATEGORIES.PROVIDER,
  message: 'The provider refund failed.',
  retryable: false,
});

function createdRefund() {
  const payment = applyCapture(
    applyAuthorization(
      beginAuthorization(
        createPayment({
          id: asPaymentId('01934567-89ab-7cde-8f01-23456789abcd'),
          organizationId: asOrganizationId('01934567-89ab-7cde-8f01-23456789abce'),
          requestedAmount: createMoney(10000n, 'USD'),
          captureMethod: CAPTURE_METHODS.AUTOMATIC,
          paymentMethod: createPaymentMethodReference({ id: 'pm_1', type: 'CARD' }),
        }),
      ),
      createMoney(10000n, 'USD'),
    ),
    createMoney(10000n, 'USD'),
  );
  return createRefund({
    id: asRefundId('01934567-89ab-7cde-8f01-23456789abcf'),
    payment,
    amount: createMoney(4000n, 'USD'),
  });
}

describe('applyRefundProviderObservation', () => {
  it('fast-forwards CREATED to SUCCEEDED', () => {
    const applied = applyRefundProviderObservation(createdRefund(), {
      state: 'SUCCEEDED',
      amount: createMoney(4000n, 'USD'),
      observedAt: NOW,
    });
    expect(applied.kind).toBe('APPLIED');
    if (applied.kind !== 'APPLIED') {
      return;
    }
    expect(applied.fromStatus).toBe('CREATED');
    expect(applied.toStatus).toBe('SUCCEEDED');
  });

  it('no-ops a second succeeded observation', () => {
    const refund = succeedRefund(createdRefund());
    const again = applyRefundProviderObservation(refund, {
      state: 'SUCCEEDED',
      amount: createMoney(4000n, 'USD'),
      observedAt: NOW,
    });
    expect(again.kind).toBe('NOOP_ALREADY_CURRENT');
  });

  it('does not regress SUCCEEDED to FAILED', () => {
    const refund = succeedRefund(beginRefundProcessing(createdRefund()));
    const stale = applyRefundProviderObservation(refund, {
      state: 'FAILED',
      amount: createMoney(4000n, 'USD'),
      failure: FAILURE,
      observedAt: NOW,
    });
    expect(stale.kind).toBe('NOOP_STALE');
    if (stale.kind !== 'NOOP_STALE') {
      return;
    }
    expect(stale.refund.status).toBe('SUCCEEDED');
  });

  it('rejects amount mismatches without mutating', () => {
    const applied = applyRefundProviderObservation(createdRefund(), {
      state: 'SUCCEEDED',
      amount: createMoney(5000n, 'USD'),
      observedAt: NOW,
    });
    expect(applied).toMatchObject({ kind: 'ANOMALY', reason: 'AMOUNT_MISMATCH' });
  });
});
