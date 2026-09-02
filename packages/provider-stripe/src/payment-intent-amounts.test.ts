import { createMoney } from '@fraterunion-payments/payment-core';
import { describe, expect, it } from 'vitest';
import { mapStripePaymentIntentAmounts } from './payment-intent-amounts.js';
import type { StripePaymentIntentSnapshot } from './stripe-client.js';

function intent(overrides: Partial<StripePaymentIntentSnapshot>): StripePaymentIntentSnapshot {
  return {
    id: 'pi_1',
    status: 'requires_payment_method',
    amount: 5000,
    currency: 'usd',
    capture_method: 'automatic',
    amount_capturable: 0,
    amount_received: 0,
    last_payment_error: null,
    next_action: null,
    ...overrides,
  };
}

describe('Stripe PaymentIntent amount formulas', () => {
  it('omits authorized and captured amounts when nothing is held or received', () => {
    expect(mapStripePaymentIntentAmounts(intent({}))).toEqual({
      requestedAmount: createMoney(5000n, 'USD'),
    });
  });

  it('treats manual requires_capture as authorized, not captured', () => {
    expect(
      mapStripePaymentIntentAmounts(
        intent({
          status: 'requires_capture',
          capture_method: 'manual',
          amount_capturable: 5000,
          amount_received: 0,
        }),
      ),
    ).toEqual({
      requestedAmount: createMoney(5000n, 'USD'),
      authorizedAmount: createMoney(5000n, 'USD'),
    });
  });

  it('treats automatic succeeded as captured and authorized equal to received', () => {
    expect(
      mapStripePaymentIntentAmounts(
        intent({
          status: 'succeeded',
          amount_capturable: 0,
          amount_received: 5000,
        }),
      ),
    ).toEqual({
      requestedAmount: createMoney(5000n, 'USD'),
      authorizedAmount: createMoney(5000n, 'USD'),
      capturedAmount: createMoney(5000n, 'USD'),
    });
  });

  it('derives partial capture from amount_received and remaining capturable', () => {
    expect(
      mapStripePaymentIntentAmounts(
        intent({
          status: 'succeeded',
          capture_method: 'manual',
          amount_capturable: 0,
          amount_received: 2000,
        }),
      ),
    ).toEqual({
      requestedAmount: createMoney(5000n, 'USD'),
      authorizedAmount: createMoney(2000n, 'USD'),
      capturedAmount: createMoney(2000n, 'USD'),
    });
  });

  it('does not treat amount_received as authorized for uncaptured manual payments', () => {
    const mapped = mapStripePaymentIntentAmounts(
      intent({
        status: 'requires_capture',
        capture_method: 'manual',
        amount_capturable: 5000,
        amount_received: 0,
      }),
    );
    expect(mapped.capturedAmount).toBeUndefined();
    expect(mapped.authorizedAmount).toEqual(createMoney(5000n, 'USD'));
  });
});
