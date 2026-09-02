import {
  asPaymentProviderCode,
  createProviderCapabilities,
} from '@fraterunion-payments/provider-contracts';

export const STRIPE_PROVIDER_CODE = asPaymentProviderCode('stripe');

/**
 * Capabilities this adapter intentionally implements.
 *
 * `multipleCapture` is false: Stripe multicapture requires specialized
 * PaymentIntent setup (`final_capture: false` and related constraints).
 * This adapter always uses Stripe's default final capture.
 */
export const STRIPE_PROVIDER_CAPABILITIES = createProviderCapabilities({
  manualCapture: true,
  partialCapture: true,
  multipleCapture: false,
  fullRefund: true,
  partialRefund: true,
  customerVault: true,
});
