import { runPaymentProviderContractTests } from '../testing/contract-tests.js';
import { createFakePaymentProvider } from './fake-provider.js';

runPaymentProviderContractTests({
  createProvider: () => createFakePaymentProvider(),
});

runPaymentProviderContractTests({
  createProvider: () =>
    createFakePaymentProvider({
      code: 'limited',
      capabilities: {
        manualCapture: false,
        partialCapture: false,
        multipleCapture: false,
        fullRefund: false,
        partialRefund: false,
        customerVault: false,
      },
    }),
});
