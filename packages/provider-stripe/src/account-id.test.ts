import { ProviderContractError } from '@fraterunion-payments/provider-contracts';
import { describe, expect, it } from 'vitest';
import { asStripeAccountId, stripeAccountReference } from './account-id.js';

describe('Stripe connected-account id validation', () => {
  it('accepts opaque acct_ identities and rejects UUID or empty values', () => {
    expect(asStripeAccountId('acct_1ABC')).toBe('acct_1ABC');
    expect(stripeAccountReference('acct_1ABC')).toEqual({
      provider: 'stripe',
      id: 'acct_1ABC',
    });
    expect(() => asStripeAccountId('')).toThrow(ProviderContractError);
    expect(() => asStripeAccountId('01934567-89ab-7cde-8f01-23456789abcd')).toThrow(
      ProviderContractError,
    );
    expect(() => asStripeAccountId('cus_123')).toThrow(ProviderContractError);
    expect(() => asStripeAccountId('acct_1\u0001')).toThrow(ProviderContractError);
  });
});
