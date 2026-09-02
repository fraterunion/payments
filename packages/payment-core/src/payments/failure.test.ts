import { describe, expect, it } from 'vitest';
import { createPaymentFailure, PAYMENT_FAILURE_CATEGORIES } from './failure.js';

describe('PaymentFailure', () => {
  it('creates an immutable normalized failure', () => {
    const failure = createPaymentFailure({
      category: PAYMENT_FAILURE_CATEGORIES.INSUFFICIENT_FUNDS,
      message: 'Insufficient funds',
      retryable: false,
      code: 'insufficient_funds',
    });
    expect(failure).toEqual({
      category: 'INSUFFICIENT_FUNDS',
      message: 'Insufficient funds',
      retryable: false,
      code: 'insufficient_funds',
    });
    expect(() => {
      (failure as { retryable: boolean }).retryable = true;
    }).toThrow();
  });

  it('allows retryable processing failures without a code', () => {
    const failure = createPaymentFailure({
      category: PAYMENT_FAILURE_CATEGORIES.PROCESSING,
      message: 'Try again',
      retryable: true,
    });
    expect(failure.retryable).toBe(true);
    expect(failure.code).toBeUndefined();
  });

  it('rejects empty message or code and unknown categories', () => {
    expect(() =>
      createPaymentFailure({
        category: PAYMENT_FAILURE_CATEGORIES.UNKNOWN,
        message: '   ',
        retryable: false,
      }),
    ).toThrow(/message is required/);
    expect(() =>
      createPaymentFailure({
        category: PAYMENT_FAILURE_CATEGORIES.UNKNOWN,
        message: 'x',
        retryable: false,
        code: '  ',
      }),
    ).toThrow(/code, if present/);
    expect(() =>
      createPaymentFailure({
        category: 'NOT_A_CATEGORY' as never,
        message: 'x',
        retryable: false,
      }),
    ).toThrow(/category/);
  });
});
