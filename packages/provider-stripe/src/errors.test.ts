import Stripe from 'stripe';
import {
  ProviderAuthenticationError,
  ProviderConfigurationError,
  ProviderContractError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from '@fraterunion-payments/provider-contracts';
import { describe, expect, it } from 'vitest';
import { normalizeStripeError } from './errors.js';

describe('Stripe infrastructure error mapping', () => {
  it('maps authentication failures separately from payment declines', () => {
    expect(() =>
      normalizeStripeError(
        new Stripe.errors.StripeAuthenticationError({
          message: 'Invalid API Key provided: sk_test_xxx',
          type: 'authentication_error',
          statusCode: 401,
        }),
      ),
    ).toThrow(ProviderAuthenticationError);
  });

  it('maps rate limits with retryAfterMs when Retry-After is present', () => {
    try {
      normalizeStripeError(
        new Stripe.errors.StripeRateLimitError({
          message: 'Too many requests',
          type: 'rate_limit_error',
          statusCode: 429,
          headers: { 'retry-after': '2' },
        }),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderRateLimitError);
      expect(error).toMatchObject({ retryable: true, retryAfterMs: 2000 });
    }
  });

  it('maps connection timeouts and other connection failures separately', () => {
    expect(() =>
      normalizeStripeError(
        new Stripe.errors.StripeConnectionError({
          message: 'Request timed out',
        }),
      ),
    ).toThrow(ProviderTimeoutError);
    expect(() =>
      normalizeStripeError(
        new Stripe.errors.StripeConnectionError({
          message: 'An error occurred with our connection to Stripe',
        }),
      ),
    ).toThrow(ProviderUnavailableError);
  });

  it('maps API outages and invalid requests without leaking raw Stripe errors', () => {
    expect(() =>
      normalizeStripeError(
        new Stripe.errors.StripeAPIError({
          message: 'Internal server error',
          type: 'api_error',
          statusCode: 500,
        }),
      ),
    ).toThrow(ProviderUnavailableError);
    expect(() =>
      normalizeStripeError(
        new Stripe.errors.StripeInvalidRequestError({
          message: 'No such payment_intent: pi_123',
          type: 'invalid_request_error',
          statusCode: 404,
        }),
      ),
    ).toThrow(ProviderConfigurationError);

    try {
      normalizeStripeError(
        new Stripe.errors.StripeAPIError({
          message: 'Authorization Bearer sk_test_secret exploded',
          type: 'api_error',
          statusCode: 500,
        }),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      expect((error as Error).message).not.toMatch(/sk_test|Bearer|Authorization/i);
      expect(JSON.stringify(error)).not.toMatch(/sk_test_secret/);
    }
  });

  it('maps generic network failures as unavailable', () => {
    expect(() => normalizeStripeError(new TypeError('fetch failed'))).toThrow(
      ProviderUnavailableError,
    );
    expect(() => normalizeStripeError(new Error('socket hang up timed out'))).toThrow(
      ProviderTimeoutError,
    );
  });

  it('does not treat a declined card as provider infrastructure failure when already a contract error', () => {
    const existing = new ProviderContractError('already mapped');
    expect(() => normalizeStripeError(existing)).toThrow(existing);
  });
});
