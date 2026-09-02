import { ProviderConfigurationError } from '@fraterunion-payments/provider-contracts';

const WEBHOOK_SECRET_PREFIX = 'whsec_';
const MIN_WEBHOOK_SECRET_MATERIAL = 16;

export function assertStripeWebhookSecret(secret: string): string {
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    throw new ProviderConfigurationError('Stripe webhook signing secret is required.');
  }
  const trimmed = secret.trim();
  if (!trimmed.startsWith(WEBHOOK_SECRET_PREFIX)) {
    throw new ProviderConfigurationError('Stripe webhook signing secret is invalid.');
  }
  const material = trimmed.slice(WEBHOOK_SECRET_PREFIX.length);
  if (material.length < MIN_WEBHOOK_SECRET_MATERIAL) {
    throw new ProviderConfigurationError('Stripe webhook signing secret is invalid.');
  }
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      throw new ProviderConfigurationError('Stripe webhook signing secret is invalid.');
    }
  }
  return trimmed;
}
