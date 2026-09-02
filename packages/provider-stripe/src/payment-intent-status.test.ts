import { PAYMENT_STATES } from '@fraterunion-payments/payment-core';
import { ProviderContractError } from '@fraterunion-payments/provider-contracts';
import { describe, expect, it } from 'vitest';
import { mapStripePaymentIntentStatus } from './payment-intent-status.js';

describe('Stripe PaymentIntent status mapping', () => {
  it('maps documented Stripe statuses to canonical payment states', () => {
    expect(
      mapStripePaymentIntentStatus({
        status: 'requires_payment_method',
        captureMethod: 'automatic',
        operation: 'create',
      }),
    ).toBe(PAYMENT_STATES.REQUIRES_PAYMENT_METHOD);
    expect(
      mapStripePaymentIntentStatus({
        status: 'requires_confirmation',
        captureMethod: 'automatic',
        operation: 'create',
      }),
    ).toBe(PAYMENT_STATES.REQUIRES_ACTION);
    expect(
      mapStripePaymentIntentStatus({
        status: 'requires_action',
        captureMethod: 'automatic',
        operation: 'create',
      }),
    ).toBe(PAYMENT_STATES.REQUIRES_ACTION);
    expect(
      mapStripePaymentIntentStatus({
        status: 'requires_capture',
        captureMethod: 'manual',
        operation: 'create',
      }),
    ).toBe(PAYMENT_STATES.AUTHORIZED);
    expect(
      mapStripePaymentIntentStatus({
        status: 'succeeded',
        captureMethod: 'automatic',
        operation: 'create',
      }),
    ).toBe(PAYMENT_STATES.SUCCEEDED);
    expect(
      mapStripePaymentIntentStatus({
        status: 'canceled',
        captureMethod: 'manual',
        operation: 'cancel',
      }),
    ).toBe(PAYMENT_STATES.CANCELED);
  });

  it('maps processing using capture method and current operation', () => {
    expect(
      mapStripePaymentIntentStatus({
        status: 'processing',
        captureMethod: 'manual',
        operation: 'create',
      }),
    ).toBe(PAYMENT_STATES.AUTHORIZING);
    expect(
      mapStripePaymentIntentStatus({
        status: 'processing',
        captureMethod: 'automatic',
        operation: 'create',
      }),
    ).toBe(PAYMENT_STATES.CAPTURING);
    expect(
      mapStripePaymentIntentStatus({
        status: 'processing',
        captureMethod: 'manual',
        operation: 'capture',
      }),
    ).toBe(PAYMENT_STATES.CAPTURING);
  });

  it('rejects unknown Stripe statuses instead of inventing a FUP state', () => {
    expect(() =>
      mapStripePaymentIntentStatus({
        status: 'requires_source',
        captureMethod: 'automatic',
        operation: 'retrieve',
      }),
    ).toThrow(ProviderContractError);
  });
});
