import { PAYMENT_ACTION_REQUIREMENT_TYPES } from '@fraterunion-payments/payment-core';
import { describe, expect, it } from 'vitest';
import { mapStripeNextAction } from './action-requirement.js';

describe('Stripe next_action mapping', () => {
  it('maps known action types to canonical requirement types only', () => {
    expect(mapStripeNextAction({ type: 'redirect_to_url' })).toEqual({
      type: PAYMENT_ACTION_REQUIREMENT_TYPES.REDIRECT,
    });
    expect(mapStripeNextAction({ type: 'use_stripe_sdk' })).toEqual({
      type: PAYMENT_ACTION_REQUIREMENT_TYPES.SDK,
    });
    expect(mapStripeNextAction({ type: 'oxxo_display_details' })).toEqual({
      type: PAYMENT_ACTION_REQUIREMENT_TYPES.DISPLAY_INSTRUCTIONS,
    });
  });

  it('omits unknown action types instead of leaking Stripe shape', () => {
    expect(mapStripeNextAction({ type: 'some_future_action' })).toBeUndefined();
    expect(mapStripeNextAction(null)).toBeUndefined();
  });
});
