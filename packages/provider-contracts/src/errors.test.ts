import {
  createPaymentFailure,
  PAYMENT_FAILURE_CATEGORIES,
} from '@fraterunion-payments/payment-core';
import { describe, expect, it } from 'vitest';
import {
  isProviderContractError,
  ProviderAuthenticationError,
  ProviderConfigurationError,
  ProviderContractError,
  PROVIDER_ERROR_CODES,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from './errors.js';

describe('provider contract errors', () => {
  it('classifies transport failures as retryable', () => {
    const timeout = new ProviderTimeoutError('Provider did not respond.');
    const unavailable = new ProviderUnavailableError('Provider is unavailable.');
    const limited = new ProviderRateLimitError('Slow down.', 1_000);
    expect(timeout.retryable).toBe(true);
    expect(unavailable.retryable).toBe(true);
    expect(limited.retryable).toBe(true);
    expect(limited.retryAfterMs).toBe(1_000);
    expect(timeout.code).toBe(PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT);
  });

  it('classifies configuration and authentication as terminal', () => {
    const config = new ProviderConfigurationError('Merchant account is not connected.');
    const auth = new ProviderAuthenticationError('Provider credentials were rejected.');
    expect(config.retryable).toBe(false);
    expect(auth.retryable).toBe(false);
    expect(isProviderContractError(config)).toBe(true);
  });

  it('keeps a normalized payment decline distinct from infrastructure errors', () => {
    const decline = createPaymentFailure({
      category: PAYMENT_FAILURE_CATEGORIES.DECLINED,
      message: 'The payment method was declined.',
      retryable: false,
    });
    expect(isProviderContractError(decline)).toBe(false);
    expect(decline.category).toBe('DECLINED');
    expect(new ProviderContractError('transport').retryable).toBe(false);
  });
});
