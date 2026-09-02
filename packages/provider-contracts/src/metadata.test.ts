import { describe, expect, it } from 'vitest';
import { PROVIDER_ERROR_CODES } from './errors.js';
import {
  createProviderMetadata,
  PROVIDER_METADATA_MAX_KEY_LENGTH,
  PROVIDER_METADATA_MAX_KEYS,
  PROVIDER_METADATA_MAX_VALUE_LENGTH,
} from './metadata.js';

describe('ProviderMetadata', () => {
  it('accepts safe string pairs', () => {
    const metadata = createProviderMetadata({
      fup_payment_id: '01934567-89ab-7cde-8f01-23456789abcd',
      fup_org_id: 'org-safe',
    });
    expect(metadata.fup_payment_id).toBe('01934567-89ab-7cde-8f01-23456789abcd');
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  it('rejects oversized keys, values, and maps', () => {
    expect(() =>
      createProviderMetadata({ ['k'.repeat(PROVIDER_METADATA_MAX_KEY_LENGTH + 1)]: 'v' }),
    ).toThrow(/key must be at most/);
    expect(() =>
      createProviderMetadata({ k: 'v'.repeat(PROVIDER_METADATA_MAX_VALUE_LENGTH + 1) }),
    ).toThrow(/value must be at most/);
    const tooMany: Record<string, string> = {};
    for (let i = 0; i < PROVIDER_METADATA_MAX_KEYS + 1; i += 1) {
      tooMany[`k${i}`] = 'v';
    }
    expect(() => createProviderMetadata(tooMany)).toThrow(/at most/);
  });

  it('rejects non-string values and secret-bearing keys', () => {
    expect(() => createProviderMetadata({ count: 12 })).toThrow(/must be strings/);
    expect(() => createProviderMetadata({ apiKey: 'not-a-secret-slot' })).toThrow(/secret-bearing/);
    expect(() => createProviderMetadata({ pan: '4111111111111111' })).toThrow(/secret-bearing/);
    try {
      createProviderMetadata({ secret: 'x' });
    } catch (error) {
      expect(error).toMatchObject({ code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_METADATA });
    }
  });
});
