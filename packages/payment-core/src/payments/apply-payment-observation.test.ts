import { describe, expect, it } from 'vitest';
import { asOrganizationId, asPaymentId } from '../ids/ids.js';
import { createMoney } from '../money/money.js';
import { CAPTURE_METHODS, type CaptureMethod } from './capture-method.js';
import { createPaymentFailure, PAYMENT_FAILURE_CATEGORIES } from './failure.js';
import { applyPaymentProviderObservation } from './apply-payment-observation.js';
import {
  applyAuthorization,
  attachPaymentMethod,
  beginAuthorization,
  createPayment,
  type Payment,
} from './payment.js';
import { createPaymentMethodReference } from './payment-method.js';

const PAYMENT_ID = asPaymentId('01934567-89ab-7cde-8f01-23456789abcd');
const ORG_ID = asOrganizationId('01934567-89ab-7cde-8f01-23456789abce');
const METHOD = createPaymentMethodReference({ id: 'pm_tok_1', type: 'CARD' });
const NOW = new Date('2026-09-02T18:00:00.000Z');
const FAILURE = createPaymentFailure({
  category: PAYMENT_FAILURE_CATEGORIES.DECLINED,
  message: 'Declined',
  retryable: false,
});

function created(captureMethod: CaptureMethod = CAPTURE_METHODS.AUTOMATIC): Payment {
  return createPayment({
    id: PAYMENT_ID,
    organizationId: ORG_ID,
    requestedAmount: createMoney(10000n, 'USD'),
    captureMethod,
  });
}

function authorizing(captureMethod: CaptureMethod = CAPTURE_METHODS.AUTOMATIC): Payment {
  return beginAuthorization(attachPaymentMethod(created(captureMethod), METHOD));
}

describe('applyPaymentProviderObservation', () => {
  it('fast-forwards AUTHORIZING automatic capture to SUCCEEDED', () => {
    const applied = applyPaymentProviderObservation(authorizing(), {
      state: 'SUCCEEDED',
      authorizedAmount: createMoney(10000n, 'USD'),
      capturedAmount: createMoney(10000n, 'USD'),
      observedAt: NOW,
    });
    expect(applied.kind).toBe('APPLIED');
    if (applied.kind !== 'APPLIED') {
      return;
    }
    expect(applied.fromStatus).toBe('AUTHORIZING');
    expect(applied.toStatus).toBe('SUCCEEDED');
    expect(applied.payment.authorizedAmount.amount).toBe(10000n);
    expect(applied.payment.capturedAmount.amount).toBe(10000n);
  });

  it('authorizes a manual capture snapshot without capturing', () => {
    const applied = applyPaymentProviderObservation(authorizing(CAPTURE_METHODS.MANUAL), {
      state: 'AUTHORIZED',
      authorizedAmount: createMoney(10000n, 'USD'),
      observedAt: NOW,
    });
    expect(applied.kind).toBe('APPLIED');
    if (applied.kind !== 'APPLIED') {
      return;
    }
    expect(applied.toStatus).toBe('AUTHORIZED');
    expect(applied.payment.authorizedAmount.amount).toBe(10000n);
    expect(applied.payment.capturedAmount.amount).toBe(0n);
  });

  it('maps requires-payment-method off AUTHORIZING to REQUIRES_PAYMENT_METHOD, not FAILED', () => {
    const applied = applyPaymentProviderObservation(authorizing(), {
      state: 'REQUIRES_PAYMENT_METHOD',
      failure: FAILURE,
      observedAt: NOW,
    });
    expect(applied.kind).toBe('APPLIED');
    if (applied.kind !== 'APPLIED') {
      return;
    }
    expect(applied.toStatus).toBe('REQUIRES_PAYMENT_METHOD');
    expect(applied.payment.failure).toBeUndefined();
  });

  it('treats decreasing captured amount as stale', () => {
    const paid = applyPaymentProviderObservation(authorizing(), {
      state: 'SUCCEEDED',
      authorizedAmount: createMoney(10000n, 'USD'),
      capturedAmount: createMoney(10000n, 'USD'),
      observedAt: NOW,
    });
    expect(paid.kind).toBe('APPLIED');
    if (paid.kind !== 'APPLIED') {
      return;
    }
    const stale = applyPaymentProviderObservation(paid.payment, {
      state: 'CAPTURING',
      authorizedAmount: createMoney(10000n, 'USD'),
      capturedAmount: createMoney(0n, 'USD'),
      observedAt: NOW,
    });
    expect(stale.kind).toBe('NOOP_STALE');
    if (stale.kind !== 'NOOP_STALE') {
      return;
    }
    expect(stale.payment.status).toBe('SUCCEEDED');
  });

  it('does not resurrect FAILED into SUCCEEDED', () => {
    const failed = applyPaymentProviderObservation(authorizing(), {
      state: 'FAILED',
      failure: FAILURE,
      observedAt: NOW,
    });
    expect(failed.kind).toBe('APPLIED');
    if (failed.kind !== 'APPLIED') {
      return;
    }
    const contradiction = applyPaymentProviderObservation(failed.payment, {
      state: 'SUCCEEDED',
      authorizedAmount: createMoney(10000n, 'USD'),
      capturedAmount: createMoney(10000n, 'USD'),
      observedAt: NOW,
    });
    expect(contradiction.kind).toBe('ANOMALY');
    if (contradiction.kind !== 'ANOMALY') {
      return;
    }
    expect(contradiction.reason).toBe('CLOSED_STATE_CONTRADICTION');
  });

  it('rejects AUTHORIZED observations on automatic capture', () => {
    const applied = applyPaymentProviderObservation(authorizing(), {
      state: 'AUTHORIZED',
      authorizedAmount: createMoney(10000n, 'USD'),
      observedAt: NOW,
    });
    expect(applied).toMatchObject({ kind: 'ANOMALY', reason: 'AUTHORIZED_ON_AUTOMATIC_CAPTURE' });
  });

  it('no-ops when state and amounts already match', () => {
    const authorized = applyAuthorization(
      authorizing(CAPTURE_METHODS.MANUAL),
      createMoney(10000n, 'USD'),
    );
    const again = applyPaymentProviderObservation(authorized, {
      state: 'AUTHORIZED',
      authorizedAmount: createMoney(10000n, 'USD'),
      observedAt: NOW,
    });
    expect(again.kind).toBe('NOOP_ALREADY_CURRENT');
  });
});
