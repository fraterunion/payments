import { describe, expect, it } from 'vitest';
import { asOrganizationId, asPaymentId } from '../ids/ids.js';
import { createMoney } from '../money/money.js';
import { CAPTURE_METHODS } from './capture-method.js';
import { createPaymentFailure, PAYMENT_FAILURE_CATEGORIES } from './failure.js';
import {
  applyAuthorization,
  applyCapture,
  applyRefund,
  attachPaymentMethod,
  beginAuthorization,
  beginCapture,
  canBeginAuthorization,
  canBeginCapture,
  canCancelPayment,
  canRefundPayment,
  cancelPayment,
  createPayment,
  derivePaymentRefundState,
  failPayment,
  isFullyCaptured,
  isFullyRefunded,
  isPartiallyCaptured,
  isPartiallyRefunded,
  markRequiresPaymentMethod,
  refundableAmount,
  remainingCapturableAmount,
  requireCustomerAction,
  resumeAuthorization,
  returnToRequiresPaymentMethod,
  type Payment,
} from './payment.js';
import { createPaymentMethodReference } from './payment-method.js';

const PAYMENT_ID = asPaymentId('01934567-89ab-7cde-8f01-23456789abcd');
const ORG_ID = asOrganizationId('01934567-89ab-7cde-8f01-23456789abce');
const METHOD = createPaymentMethodReference({ id: 'pm_tok_1', type: 'CARD' });

function newPayment(overrides: Partial<Parameters<typeof createPayment>[0]> = {}): Payment {
  return createPayment({
    id: PAYMENT_ID,
    organizationId: ORG_ID,
    requestedAmount: createMoney(10000n, 'USD'),
    captureMethod: CAPTURE_METHODS.MANUAL,
    paymentMethod: METHOD,
    ...overrides,
  });
}

function authorized(amount = 10000n): Payment {
  return applyAuthorization(beginAuthorization(newPayment()), createMoney(amount, 'USD'));
}

function succeeded(captured = 10000n, authorizedAmount = 10000n): Payment {
  const payment =
    captured === authorizedAmount
      ? applyAuthorization(
          beginAuthorization(newPayment({ captureMethod: CAPTURE_METHODS.AUTOMATIC })),
          createMoney(authorizedAmount, 'USD'),
        )
      : beginCapture(authorized(authorizedAmount));
  return applyCapture(payment, createMoney(captured, 'USD'));
}

describe('payment aggregate', () => {
  it('creates CREATED payments with requestedAmount > 0 and zeroed balances', () => {
    const payment = newPayment();
    expect(payment.status).toBe('CREATED');
    expect(payment.authorizedAmount.amount).toBe(0n);
    expect(payment.capturedAmount.amount).toBe(0n);
    expect(payment.refundedAmount.amount).toBe(0n);
    expect(() =>
      createPayment({
        id: PAYMENT_ID,
        organizationId: ORG_ID,
        requestedAmount: createMoney(0n, 'USD'),
        captureMethod: CAPTURE_METHODS.MANUAL,
      }),
    ).toThrow(/greater than zero/);
  });

  it('follows CREATED → REQUIRES_PAYMENT_METHOD → AUTHORIZING', () => {
    const created = createPayment({
      id: PAYMENT_ID,
      organizationId: ORG_ID,
      requestedAmount: createMoney(10000n, 'USD'),
      captureMethod: CAPTURE_METHODS.MANUAL,
    });
    expect(canBeginAuthorization(created)).toBe(false);
    const waiting = markRequiresPaymentMethod(created);
    expect(waiting.status).toBe('REQUIRES_PAYMENT_METHOD');
    const attached = attachPaymentMethod(waiting, METHOD);
    expect(canBeginAuthorization(attached)).toBe(true);
    expect(beginAuthorization(attached).status).toBe('AUTHORIZING');
  });

  it('follows CREATED → AUTHORIZING when a method already exists', () => {
    expect(beginAuthorization(newPayment()).status).toBe('AUTHORIZING');
  });

  it('supports the authentication loop AUTHORIZING ⇄ REQUIRES_ACTION', () => {
    const authorizing = beginAuthorization(newPayment());
    const action = requireCustomerAction(authorizing);
    expect(action.status).toBe('REQUIRES_ACTION');
    expect(resumeAuthorization(action).status).toBe('AUTHORIZING');
  });

  it('authorizes fully or partially and rejects over-authorization', () => {
    const partial = applyAuthorization(beginAuthorization(newPayment()), createMoney(8000n, 'USD'));
    expect(partial.status).toBe('AUTHORIZED');
    expect(partial.authorizedAmount.amount).toBe(8000n);
    expect(() =>
      applyAuthorization(beginAuthorization(newPayment()), createMoney(10001n, 'USD')),
    ).toThrow(/cannot exceed requestedAmount/);
    expect(() =>
      applyAuthorization(beginAuthorization(newPayment()), createMoney(0n, 'USD')),
    ).toThrow(/greater than zero/);
  });

  it('moves AUTOMATIC authorization to CAPTURING', () => {
    const capturing = applyAuthorization(
      beginAuthorization(newPayment({ captureMethod: CAPTURE_METHODS.AUTOMATIC })),
      createMoney(10000n, 'USD'),
    );
    expect(capturing.status).toBe('CAPTURING');
  });

  it('captures fully or partially and rejects overflow or zero', () => {
    const capturing = beginCapture(authorized());
    expect(canBeginCapture(authorized())).toBe(true);
    const partial = applyCapture(capturing, createMoney(4000n, 'USD'));
    expect(partial.status).toBe('SUCCEEDED');
    expect(partial.capturedAmount.amount).toBe(4000n);
    expect(isPartiallyCaptured(partial)).toBe(true);
    expect(isFullyCaptured(partial)).toBe(false);
    expect(remainingCapturableAmount(partial).amount).toBe(0n);

    expect(() => applyCapture(beginCapture(authorized()), createMoney(0n, 'USD'))).toThrow(
      /greater than zero/,
    );
    expect(() => applyCapture(beginCapture(authorized()), createMoney(10001n, 'USD'))).toThrow(
      /remaining authorized/,
    );
  });

  it('returns AUTHORIZING/REQUIRES_ACTION to REQUIRES_PAYMENT_METHOD without failing', () => {
    const authorizing = beginAuthorization(newPayment());
    expect(returnToRequiresPaymentMethod(authorizing).status).toBe('REQUIRES_PAYMENT_METHOD');
    expect(returnToRequiresPaymentMethod(requireCustomerAction(authorizing)).status).toBe(
      'REQUIRES_PAYMENT_METHOD',
    );
    expect(canCancelPayment(newPayment())).toBe(true);
    expect(canCancelPayment(authorizing)).toBe(true);
  });

  it('cancels AUTHORIZED payments and fails AUTHORIZING/CAPTURING', () => {
    const auth = authorized();
    expect(canCancelPayment(auth)).toBe(true);
    expect(cancelPayment(auth).status).toBe('CANCELED');
    const failure = createPaymentFailure({
      category: PAYMENT_FAILURE_CATEGORIES.DECLINED,
      message: 'Declined',
      retryable: false,
    });
    expect(failPayment(beginAuthorization(newPayment()), failure).status).toBe('FAILED');
    expect(failPayment(beginCapture(auth), failure).status).toBe('FAILED');
  });

  it('refunds partially then fully and rejects overflow or zero', () => {
    const paid = succeeded();
    expect(canRefundPayment(paid)).toBe(true);
    const partial = applyRefund(paid, createMoney(2500n, 'USD'));
    expect(partial.status).toBe('PARTIALLY_REFUNDED');
    expect(isPartiallyRefunded(partial)).toBe(true);
    const full = applyRefund(partial, createMoney(7500n, 'USD'));
    expect(full.status).toBe('REFUNDED');
    expect(isFullyRefunded(full)).toBe(true);
    expect(canRefundPayment(full)).toBe(false);

    expect(applyRefund(paid, createMoney(10000n, 'USD')).status).toBe('REFUNDED');
    expect(() => applyRefund(paid, createMoney(0n, 'USD'))).toThrow(/greater than zero/);
    expect(() => applyRefund(paid, createMoney(10001n, 'USD'))).toThrow(/remaining captured/);
    expect(() => applyRefund(paid, createMoney(100n, 'MXN'))).toThrow(/Currency mismatch/);
  });

  it('derives refund economic state without overriding execution failures', () => {
    expect(
      derivePaymentRefundState({
        executionState: 'SUCCEEDED',
        capturedAmount: 100n,
        refundedAmount: 0n,
      }),
    ).toBe('SUCCEEDED');
    expect(
      derivePaymentRefundState({
        executionState: 'SUCCEEDED',
        capturedAmount: 100n,
        refundedAmount: 40n,
      }),
    ).toBe('PARTIALLY_REFUNDED');
    expect(
      derivePaymentRefundState({
        executionState: 'PARTIALLY_REFUNDED',
        capturedAmount: 100n,
        refundedAmount: 100n,
      }),
    ).toBe('REFUNDED');
    expect(
      derivePaymentRefundState({
        executionState: 'FAILED',
        capturedAmount: 0n,
        refundedAmount: 0n,
      }),
    ).toBe('FAILED');
    expect(() =>
      derivePaymentRefundState({
        executionState: 'FAILED',
        capturedAmount: 0n,
        refundedAmount: 1n,
      }),
    ).toThrow(/non-successful/);
    expect(() =>
      derivePaymentRefundState({
        executionState: 'SUCCEEDED',
        capturedAmount: 100n,
        refundedAmount: 101n,
      }),
    ).toThrow(/cannot exceed capturedAmount/);
  });

  it('preserves 0 <= refunded <= captured <= authorized <= requested', () => {
    const samples: Payment[] = [
      newPayment(),
      beginAuthorization(newPayment()),
      authorized(8000n),
      succeeded(4000n, 8000n),
      applyRefund(succeeded(8000n, 8000n), createMoney(3000n, 'USD')),
      applyRefund(succeeded(), createMoney(10000n, 'USD')),
    ];

    for (const payment of samples) {
      expect(payment.refundedAmount.amount).toBeGreaterThanOrEqual(0n);
      expect(payment.refundedAmount.amount).toBeLessThanOrEqual(payment.capturedAmount.amount);
      expect(payment.capturedAmount.amount).toBeLessThanOrEqual(payment.authorizedAmount.amount);
      expect(payment.authorizedAmount.amount).toBeLessThanOrEqual(payment.requestedAmount.amount);
    }
    expect(refundableAmount(succeeded()).amount).toBe(10000n);
  });

  it('does not allow authorize/capture after a closed execution state', () => {
    const paid = succeeded();
    expect(() => beginAuthorization(paid)).toThrow(/cannot transition/);
    expect(() => applyCapture(paid, createMoney(1n, 'USD'))).toThrow(/Cannot apply capture/);
    expect(() =>
      applyRefund(
        failPayment(
          beginAuthorization(newPayment()),
          createPaymentFailure({
            category: PAYMENT_FAILURE_CATEGORIES.DECLINED,
            message: 'no',
            retryable: false,
          }),
        ),
        createMoney(1n, 'USD'),
      ),
    ).toThrow(/Cannot refund/);
  });

  it('uses the same currency on every amount', () => {
    const payment = succeeded();
    expect(
      new Set([
        payment.requestedAmount.currency,
        payment.authorizedAmount.currency,
        payment.capturedAmount.currency,
        payment.refundedAmount.currency,
      ]),
    ).toEqual(new Set(['USD']));
  });
});
