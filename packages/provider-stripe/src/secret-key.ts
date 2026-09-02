import { ProviderConfigurationError } from '@fraterunion-payments/provider-contracts';

/**
 * Never log, return, or interpolate the key. Live credentials are refused
 * outside production so tests cannot accidentally charge real money.
 */
export function assertStripeSecretKeyMode(
  secretKey: string,
  options: { readonly allowLive: boolean },
): void {
  if (typeof secretKey !== 'string' || secretKey.trim().length === 0) {
    throw new ProviderConfigurationError('Stripe secret key is required.');
  }
  const trimmed = secretKey.trim();
  if (trimmed.startsWith('sk_live_') && !options.allowLive) {
    throw new ProviderConfigurationError(
      'Live Stripe credentials are not permitted in this environment.',
    );
  }
}
