import { ProviderContractError, PROVIDER_ERROR_CODES } from './errors.js';
import { rejectControlCharacters } from './text.js';

export type ProviderMetadata = Readonly<Record<string, string>>;

export const PROVIDER_METADATA_MAX_KEYS = 20;
export const PROVIDER_METADATA_MAX_KEY_LENGTH = 40;
export const PROVIDER_METADATA_MAX_VALUE_LENGTH = 500;

const FORBIDDEN_METADATA_KEYS = new Set([
  'apikey',
  'api_key',
  'secret',
  'secretkey',
  'secret_key',
  'password',
  'authorization',
  'pan',
  'cvc',
  'cardnumber',
  'card_number',
]);

/**
 * Provider-safe metadata only: string keys and string values.
 * Adapters may apply stricter size limits. Do not put secrets here.
 */
export function createProviderMetadata(input: Readonly<Record<string, unknown>>): ProviderMetadata {
  const entries = Object.entries(input);
  if (entries.length > PROVIDER_METADATA_MAX_KEYS) {
    throw new ProviderContractError(
      `Provider metadata allows at most ${PROVIDER_METADATA_MAX_KEYS} keys.`,
      { code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_METADATA },
    );
  }

  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
      throw new ProviderContractError('Provider metadata keys must be non-empty strings.', {
        code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_METADATA,
      });
    }
    const key = rawKey.trim();
    if (key.length > PROVIDER_METADATA_MAX_KEY_LENGTH) {
      throw new ProviderContractError(
        `Provider metadata key must be at most ${PROVIDER_METADATA_MAX_KEY_LENGTH} characters.`,
        { code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_METADATA },
      );
    }
    rejectControlCharacters(
      key,
      'Provider metadata key',
      PROVIDER_ERROR_CODES.INVALID_PROVIDER_METADATA,
    );
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
      throw new ProviderContractError(
        `Provider metadata must not include secret-bearing key "${key}".`,
        { code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_METADATA },
      );
    }
    if (typeof rawValue !== 'string') {
      throw new ProviderContractError('Provider metadata values must be strings.', {
        code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_METADATA,
      });
    }
    if (rawValue.length > PROVIDER_METADATA_MAX_VALUE_LENGTH) {
      throw new ProviderContractError(
        `Provider metadata value must be at most ${PROVIDER_METADATA_MAX_VALUE_LENGTH} characters.`,
        { code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_METADATA },
      );
    }
    rejectControlCharacters(
      rawValue,
      'Provider metadata value',
      PROVIDER_ERROR_CODES.INVALID_PROVIDER_METADATA,
    );
    result[key] = rawValue;
  }

  return Object.freeze(result);
}
