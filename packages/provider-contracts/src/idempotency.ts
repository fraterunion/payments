import { PROVIDER_ERROR_CODES } from './errors.js';
import { requireBoundedText } from './text.js';

declare const brand: unique symbol;

/**
 * Application-generated key. Adapters must forward this to the provider
 * and must not invent a replacement on retry.
 */
export type ProviderIdempotencyKey = string & { readonly [brand]: 'ProviderIdempotencyKey' };

export const PROVIDER_IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export function asProviderIdempotencyKey(value: string): ProviderIdempotencyKey {
  return requireBoundedText(
    value,
    'idempotency key',
    PROVIDER_IDEMPOTENCY_KEY_MAX_LENGTH,
    PROVIDER_ERROR_CODES.INVALID_IDEMPOTENCY_KEY,
  ) as ProviderIdempotencyKey;
}
