import { ProviderConfigurationError } from '@fraterunion-payments/provider-contracts';
import { describe, expect, it } from 'vitest';
import { buildStripeAccountOnboardingLinkParams } from './account-link.js';

describe('buildStripeAccountOnboardingLinkParams', () => {
  it('builds an Accounts v2 hosted onboarding link for merchant configuration', () => {
    expect(
      buildStripeAccountOnboardingLinkParams({
        providerAccountId: 'acct_123',
        returnUrl: 'https://admin.example.com/payments/return',
        refreshUrl: 'https://admin.example.com/payments/refresh',
        environment: 'production',
      }),
    ).toEqual({
      account: 'acct_123',
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['merchant'],
          return_url: 'https://admin.example.com/payments/return',
          refresh_url: 'https://admin.example.com/payments/refresh',
        },
      },
    });
  });

  it('rejects non-HTTPS production redirects and credentialed URLs', () => {
    expect(() =>
      buildStripeAccountOnboardingLinkParams({
        providerAccountId: 'acct_123',
        returnUrl: 'http://admin.example.com/return',
        refreshUrl: 'https://admin.example.com/refresh',
        environment: 'production',
      }),
    ).toThrow(ProviderConfigurationError);
    expect(() =>
      buildStripeAccountOnboardingLinkParams({
        providerAccountId: 'acct_123',
        returnUrl: 'https://user:pass@admin.example.com/return',
        refreshUrl: 'https://admin.example.com/refresh',
        environment: 'production',
      }),
    ).toThrow(/credentials/);
  });

  it('allows localhost HTTP outside production', () => {
    const params = buildStripeAccountOnboardingLinkParams({
      providerAccountId: 'acct_123',
      returnUrl: 'http://localhost:3000/return',
      refreshUrl: 'http://127.0.0.1:3000/refresh',
      environment: 'test',
    });
    expect(params.use_case.account_onboarding.return_url).toContain('localhost');
  });
});
