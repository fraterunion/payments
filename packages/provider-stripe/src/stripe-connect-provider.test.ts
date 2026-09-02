import {
  asProviderIdempotencyKey,
  createProviderAccountReference,
  ProviderConfigurationError,
  ProviderMismatchError,
  ProviderUnavailableError,
} from '@fraterunion-payments/provider-contracts';
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { STRIPE_API_VERSION } from './api-version.js';
import { PROVIDER_ACCOUNT_STATUSES } from './connect-types.js';
import { StripeConnectProvider } from './stripe-connect-provider.js';
import { createFakeStripeConnectClient } from './test/fake-stripe-connect-client.js';

const NOW = new Date('2026-09-02T16:00:00.000Z');
const IDEMPOTENCY = asProviderIdempotencyKey('fup:'.padEnd(68, 'a'));

function provider(client = createFakeStripeConnectClient()) {
  return {
    client,
    connect: new StripeConnectProvider(
      { secretKey: 'sk_test_fake', allowLive: false, urlEnvironment: 'test' },
      { client, now: () => NOW },
    ),
  };
}

describe('StripeConnectProvider', () => {
  it('creates a connected account with merchant configuration and forwards the provider idempotency key', async () => {
    const { client, connect } = provider();
    const observation = await connect.createConnectedAccount({
      displayName: 'GymOS Demo',
      country: 'US',
      defaultCurrency: 'USD',
      idempotencyKey: IDEMPOTENCY,
    });
    expect(observation.status).toBe(PROVIDER_ACCOUNT_STATUSES.REQUIRES_ACTION);
    expect(observation.providerAccountReference.provider).toBe('stripe');
    expect(observation.providerAccountReference.id.startsWith('acct_')).toBe(true);
    expect(client.lastCreateOptions[0]?.idempotencyKey).toBe(IDEMPOTENCY);
    expect(client.lastCreateParams[0]?.configuration.merchant.capabilities.card_payments).toEqual({
      requested: true,
    });
    expect(client.lastCreateParams[0]?.dashboard).toBe('full');
    expect(JSON.stringify(observation)).not.toContain('configuration');
    expect(JSON.stringify(observation)).not.toContain('currently_due');
  });

  it('reuses the same Stripe account when the same provider idempotency key is retried', async () => {
    const { connect } = provider();
    const first = await connect.createConnectedAccount({
      displayName: 'GymOS Demo',
      country: 'US',
      defaultCurrency: 'USD',
      idempotencyKey: IDEMPOTENCY,
    });
    const second = await connect.createConnectedAccount({
      displayName: 'GymOS Demo',
      country: 'US',
      defaultCurrency: 'USD',
      idempotencyKey: IDEMPOTENCY,
    });
    expect(second.providerAccountReference.id).toBe(first.providerAccountReference.id);
  });

  it('retrieves and remaps readiness without exposing the raw Stripe account', async () => {
    const { client, connect } = provider();
    const created = await connect.createConnectedAccount({
      displayName: 'GymOS Demo',
      country: 'US',
      defaultCurrency: 'USD',
      idempotencyKey: IDEMPOTENCY,
    });
    client.setAccount({
      id: created.providerAccountReference.id,
      configuration: {
        merchant: {
          applied: true,
          capabilities: {
            card_payments: { status: 'active' },
            stripe_balance: { payouts: { status: 'active' } },
          },
        },
      },
    });
    const retrieved = await connect.retrieveConnectedAccount({
      providerAccountReference: created.providerAccountReference,
    });
    expect(retrieved.status).toBe(PROVIDER_ACCOUNT_STATUSES.ACTIVE);
    expect(retrieved.paymentsEnabled).toBe(true);
    expect(JSON.stringify(retrieved)).not.toContain('card_payments');
  });

  it('rejects provider ownership mismatch on retrieve', async () => {
    const { connect } = provider();
    await expect(
      connect.retrieveConnectedAccount({
        providerAccountReference: createProviderAccountReference({
          provider: 'adyen',
          id: 'acct_other',
        }),
      }),
    ).rejects.toBeInstanceOf(ProviderMismatchError);
  });

  it('mints a single-use hosted onboarding link and does not invent expiry', async () => {
    const { client, connect } = provider();
    const created = await connect.createConnectedAccount({
      displayName: 'GymOS Demo',
      country: 'US',
      defaultCurrency: 'USD',
      idempotencyKey: IDEMPOTENCY,
    });
    const first = await connect.createHostedOnboardingLink({
      providerAccountReference: created.providerAccountReference,
      returnUrl: 'http://localhost:3000/return',
      refreshUrl: 'http://localhost:3000/refresh',
    });
    const second = await connect.createHostedOnboardingLink({
      providerAccountReference: created.providerAccountReference,
      returnUrl: 'http://localhost:3000/return',
      refreshUrl: 'http://localhost:3000/refresh',
    });
    expect(first.url).toContain('https://connect.stripe.com/');
    expect(first.expiresAt?.toISOString()).toBe('2026-09-02T18:00:00.000Z');
    expect(second.url).not.toBe(first.url);
    expect(client.lastAccountLinkParams[0]?.use_case.type).toBe('account_onboarding');
    expect(client.lastAccountLinkOptions[0]?.idempotencyKey).toBeUndefined();
  });

  it('rejects live keys outside production and invalid API versions', () => {
    expect(
      () => new StripeConnectProvider({ secretKey: 'sk_live_should_not_run', allowLive: false }),
    ).toThrow(ProviderConfigurationError);
    expect(
      () =>
        new StripeConnectProvider({
          secretKey: 'sk_test_fake',
          apiVersion: '2024-01-01' as typeof STRIPE_API_VERSION,
        }),
    ).toThrow(/API version/);
  });

  it('normalizes Stripe errors without leaking Stripe types', async () => {
    const { client, connect } = provider();
    client.failNext(
      new Stripe.errors.StripeAPIError({
        message: 'internal error',
        type: 'api_error',
        statusCode: 500,
      }),
    );
    await expect(
      connect.createConnectedAccount({
        displayName: 'GymOS Demo',
        country: 'US',
        defaultCurrency: 'USD',
        idempotencyKey: IDEMPOTENCY,
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
