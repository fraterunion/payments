import { REFUND_REASONS, REFUND_STATES } from '@fraterunion-payments/payment-core';
import { ProviderContractError } from '@fraterunion-payments/provider-contracts';
import { describe, expect, it } from 'vitest';
import { mapStripeRefundReason, mapStripeRefundStatus } from './refund.js';

describe('Stripe refund mapping', () => {
  it('maps only Stripe-supported reasons and omits the rest', () => {
    expect(mapStripeRefundReason(REFUND_REASONS.DUPLICATE)).toBe('duplicate');
    expect(mapStripeRefundReason(REFUND_REASONS.FRAUDULENT)).toBe('fraudulent');
    expect(mapStripeRefundReason(REFUND_REASONS.CUSTOMER_REQUEST)).toBeUndefined();
    expect(mapStripeRefundReason(REFUND_REASONS.PRODUCT_OR_SERVICE)).toBeUndefined();
    expect(mapStripeRefundReason(REFUND_REASONS.OTHER)).toBeUndefined();
    expect(mapStripeRefundReason(undefined)).toBeUndefined();
  });

  it('maps Stripe refund statuses onto canonical refund states', () => {
    expect(mapStripeRefundStatus('pending')).toBe(REFUND_STATES.PROCESSING);
    expect(mapStripeRefundStatus('requires_action')).toBe(REFUND_STATES.PROCESSING);
    expect(mapStripeRefundStatus('succeeded')).toBe(REFUND_STATES.SUCCEEDED);
    expect(mapStripeRefundStatus('failed')).toBe(REFUND_STATES.FAILED);
    expect(mapStripeRefundStatus('canceled')).toBe(REFUND_STATES.FAILED);
  });

  it('rejects unknown refund statuses', () => {
    expect(() => mapStripeRefundStatus('open')).toThrow(ProviderContractError);
    expect(() => mapStripeRefundStatus(null)).toThrow(ProviderContractError);
  });
});
