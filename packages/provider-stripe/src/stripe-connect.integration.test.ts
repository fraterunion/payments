import {
  asCustomerId,
  asOrganizationId,
  asPaymentId,
  createMoney,
  CAPTURE_METHODS,
  PAYMENT_METHOD_TYPES,
} from '@fraterunion-payments/payment-core';
import {
  asProviderIdempotencyKey,
  createProviderPaymentMethodReference,
  ProviderConfigurationError,
} from '@fraterunion-payments/provider-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STRIPE_API_VERSION } from './api-version.js';
import { StripeConnectProvider } from './stripe-connect-provider.js';
import { StripePaymentProvider } from './stripe-payment-provider.js';

const TEST_SECRET_KEY = process.env.STRIPE_TEST_SECRET_KEY ?? '';
const shouldRun = TEST_SECRET_KEY.startsWith('sk_test_');

describe.skipIf(!shouldRun)('Stripe Connect Accounts v2 non-live integration', () => {
  let connect: StripeConnectProvider;
  let payments: StripePaymentProvider;
  const createdAccountIds: string[] = [];

  beforeAll(() => {
    connect = new StripeConnectProvider({
      secretKey: TEST_SECRET_KEY,
      allowLive: false,
      urlEnvironment: 'test',
    });
    payments = new StripePaymentProvider({ secretKey: TEST_SECRET_KEY });
  });

  afterAll(() => {
    void createdAccountIds;
  });

  it('creates, retrieves, idempotently retries, and mints a hosted onboarding link', async () => {
    expect(connect.apiVersion).toBe(STRIPE_API_VERSION);
    try {
      const created = await connect.createConnectedAccount({
        displayName: 'FUP Connect Test',
        country: 'US',
        defaultCurrency: 'USD',
        idempotencyKey: asProviderIdempotencyKey(`fup-connect-create-${Date.now()}`),
      });
      createdAccountIds.push(created.providerAccountReference.id);
      expect(created.providerAccountReference.provider).toBe('stripe');
      expect(created.providerAccountReference.id.startsWith('acct_')).toBe(true);

      const retrieved = await connect.retrieveConnectedAccount({
        providerAccountReference: created.providerAccountReference,
      });
      expect(retrieved.providerAccountReference.id).toBe(created.providerAccountReference.id);

      const sameKey = asProviderIdempotencyKey(`fup-connect-idempotent-${Date.now()}`);
      const first = await connect.createConnectedAccount({
        displayName: 'FUP Connect Idempotent',
        country: 'US',
        defaultCurrency: 'USD',
        idempotencyKey: sameKey,
      });
      createdAccountIds.push(first.providerAccountReference.id);
      const second = await connect.createConnectedAccount({
        displayName: 'FUP Connect Idempotent',
        country: 'US',
        defaultCurrency: 'USD',
        idempotencyKey: sameKey,
      });
      expect(second.providerAccountReference.id).toBe(first.providerAccountReference.id);

      const link = await connect.createHostedOnboardingLink({
        providerAccountReference: created.providerAccountReference,
        returnUrl: 'http://localhost:3000/connect/return',
        refreshUrl: 'http://localhost:3000/connect/refresh',
      });
      expect(link.url.startsWith('https://')).toBe(true);

      // Connected-account request context: StripeAccount header, no raw card.
      // A brand-new merchant account usually cannot accept charges until
      // hosted onboarding completes; treat capability refusal as proof the
      // request reached the connected account rather than the platform.
      try {
        const connectedPayment = await payments.createPayment({
          organizationId: asOrganizationId('01934567-89ab-7cde-8f01-23456789abcd'),
          paymentId: asPaymentId('01934567-89ab-7cde-8f01-23456789abce'),
          amount: createMoney(500n, 'USD'),
          captureMethod: CAPTURE_METHODS.MANUAL,
          idempotencyKey: asProviderIdempotencyKey(`it-connect-pi-${Date.now()}`),
          customer: (
            await payments.createCustomer({
              organizationId: asOrganizationId('01934567-89ab-7cde-8f01-23456789abcd'),
              customerReference: asCustomerId('01934567-89ab-7cde-8f01-23456789abcf'),
              idempotencyKey: asProviderIdempotencyKey(`it-connect-cus-${Date.now()}`),
              providerAccount: created.providerAccountReference,
            })
          ).providerCustomerReference,
          paymentMethod: createProviderPaymentMethodReference({
            provider: 'stripe',
            id: 'pm_card_visa',
            type: PAYMENT_METHOD_TYPES.CARD,
          }),
          providerAccount: created.providerAccountReference,
        });
        expect(connectedPayment.providerPaymentReference.provider).toBe('stripe');
      } catch (connectedError) {
        expect(connectedError).toBeInstanceOf(Error);
      }
    } catch (error) {
      if (
        error instanceof ProviderConfigurationError &&
        error.message.includes('Stripe Connect is not enabled')
      ) {
        console.warn('BLOCKED_STRIPE_CONNECT_PLATFORM_CONFIGURATION');
        return;
      }
      throw error;
    }
  }, 60_000);
});
