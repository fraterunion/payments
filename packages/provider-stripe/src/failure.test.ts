import { PAYMENT_FAILURE_CATEGORIES } from '@fraterunion-payments/payment-core';
import { describe, expect, it } from 'vitest';
import { mapStripePaymentFailure, mapStripeRefundFailure } from './failure.js';

describe('Stripe failure mapping', () => {
  it('classifies structured decline codes, not message text', () => {
    expect(
      mapStripePaymentFailure({
        type: 'card_error',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        message: 'something vague',
      }),
    ).toMatchObject({
      category: PAYMENT_FAILURE_CATEGORIES.INSUFFICIENT_FUNDS,
      code: 'insufficient_funds',
      retryable: false,
    });
    expect(
      mapStripePaymentFailure({
        type: 'card_error',
        code: 'authentication_required',
        message: 'Authenticate',
      }),
    ).toMatchObject({
      category: PAYMENT_FAILURE_CATEGORIES.AUTHENTICATION,
      retryable: true,
    });
    expect(
      mapStripePaymentFailure({
        type: 'card_error',
        code: 'expired_card',
        message: 'Expired',
      }),
    ).toMatchObject({
      category: PAYMENT_FAILURE_CATEGORIES.INVALID_PAYMENT_METHOD,
    });
    expect(
      mapStripePaymentFailure({
        type: 'card_error',
        code: 'processing_error',
        message: 'Try again',
      }),
    ).toMatchObject({
      category: PAYMENT_FAILURE_CATEGORIES.PROCESSING,
      retryable: true,
    });
    expect(
      mapStripePaymentFailure({
        type: 'card_error',
        code: 'card_declined',
        decline_code: 'generic_decline',
        message: 'Your card was declined.',
      }),
    ).toMatchObject({
      category: PAYMENT_FAILURE_CATEGORIES.DECLINED,
      code: 'generic_decline',
    });
  });

  it('does not leak secret-looking Stripe messages', () => {
    expect(
      mapStripePaymentFailure({
        type: 'card_error',
        message: 'bad key sk_test_abc123',
      })?.message,
    ).toBe('The payment method was declined.');
  });

  it('maps refund failure reasons without copying Stripe objects', () => {
    expect(mapStripeRefundFailure('lost_or_stolen_card')).toMatchObject({
      category: PAYMENT_FAILURE_CATEGORIES.PROVIDER,
      code: 'lost_or_stolen_card',
    });
    expect(mapStripeRefundFailure(null)).toBeUndefined();
  });
});
