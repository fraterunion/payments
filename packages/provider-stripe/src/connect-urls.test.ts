import { ProviderConfigurationError } from '@fraterunion-payments/provider-contracts';
import { describe, expect, it } from 'vitest';
import {
  assertStripeAccountLinkUrl,
  assertStripeConnectRedirectUrl,
  assertStripeHostedOnboardingUrls,
} from './connect-urls.js';

describe('Stripe Connect URL validation', () => {
  it('requires HTTPS in production and rejects credentials', () => {
    expect(() =>
      assertStripeConnectRedirectUrl('http://admin.example.com/return', 'return URL', 'production'),
    ).toThrow(/HTTPS/);
    expect(() =>
      assertStripeConnectRedirectUrl(
        'https://user:secret@admin.example.com/return',
        'return URL',
        'production',
      ),
    ).toThrow(/credentials/);
    expect(
      assertStripeConnectRedirectUrl(
        'https://admin.example.com/payments/return',
        'return URL',
        'production',
      ),
    ).toBe('https://admin.example.com/payments/return');
  });

  it('does not accept request-shaped arbitrary hosts in production', () => {
    expect(() =>
      assertStripeHostedOnboardingUrls({
        returnUrl: 'javascript:alert(1)',
        refreshUrl: 'https://admin.example.com/refresh',
        environment: 'production',
      }),
    ).toThrow(ProviderConfigurationError);
  });

  it('requires HTTPS for Account Link URLs returned by Stripe', () => {
    expect(assertStripeAccountLinkUrl('https://connect.stripe.com/setup/e/acct_1')).toContain(
      'connect.stripe.com',
    );
    expect(() => assertStripeAccountLinkUrl('http://connect.stripe.com/setup')).toThrow(/HTTPS/);
  });
});
