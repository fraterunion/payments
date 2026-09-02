import { ProviderConfigurationError } from '@fraterunion-payments/provider-contracts';
import { describe, expect, it } from 'vitest';
import { buildStripeAccountCreateParams } from './account-create.js';

describe('buildStripeAccountCreateParams', () => {
  it('requests merchant card payments with full dashboard and Stripe-held responsibilities', () => {
    expect(
      buildStripeAccountCreateParams({
        displayName: 'GymOS Demo',
        country: 'US',
        defaultCurrency: 'USD',
      }),
    ).toEqual({
      display_name: 'GymOS Demo',
      dashboard: 'full',
      identity: {
        country: 'us',
        entity_type: 'company',
      },
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { requested: true },
          },
        },
      },
      defaults: {
        currency: 'usd',
        responsibilities: {
          fees_collector: 'stripe',
          losses_collector: 'stripe',
        },
      },
      include: ['configuration.merchant', 'requirements', 'defaults'],
    });
  });

  it('does not request customer or recipient configuration', () => {
    const params = buildStripeAccountCreateParams({
      displayName: 'Merchant',
      country: 'CA',
      defaultCurrency: 'CAD',
    });
    expect(params.configuration).toEqual({
      merchant: {
        capabilities: {
          card_payments: { requested: true },
        },
      },
    });
    expect(JSON.stringify(params)).not.toContain('customer');
    expect(JSON.stringify(params)).not.toContain('recipient');
    expect(JSON.stringify(params)).not.toContain('application_fee');
  });

  it('rejects empty display names and invalid country/currency', () => {
    expect(() =>
      buildStripeAccountCreateParams({
        displayName: '  ',
        country: 'US',
        defaultCurrency: 'USD',
      }),
    ).toThrow(ProviderConfigurationError);
    expect(() =>
      buildStripeAccountCreateParams({
        displayName: 'Merchant',
        country: 'USA',
        defaultCurrency: 'USD',
      }),
    ).toThrow(/ISO 3166-1/);
    expect(() =>
      buildStripeAccountCreateParams({
        displayName: 'Merchant',
        country: 'US',
        defaultCurrency: 'US',
      }),
    ).toThrow(/ISO 4217/);
  });
});
