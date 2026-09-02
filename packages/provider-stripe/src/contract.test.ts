import { describe } from 'vitest';
import { runPaymentProviderContractTests } from '@fraterunion-payments/provider-contracts/testing';
import { StripePaymentProvider } from './stripe-payment-provider.js';
import { createFakeStripeClient } from './test/fake-stripe-client.js';

describe('StripePaymentProvider contract harness', () => {
  runPaymentProviderContractTests({
    createProvider: () =>
      new StripePaymentProvider(
        { secretKey: 'sk_test_fake' },
        { client: createFakeStripeClient({ behavior: 'contract' }) },
      ),
  });
});
