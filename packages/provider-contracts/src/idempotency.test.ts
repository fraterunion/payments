import { describe, expect, it } from 'vitest';
import { PROVIDER_ERROR_CODES } from './errors.js';
import { asProviderIdempotencyKey, PROVIDER_IDEMPOTENCY_KEY_MAX_LENGTH } from './idempotency.js';

describe('ProviderIdempotencyKey', () => {
  it('accepts a stable bounded key', () => {
    const key = asProviderIdempotencyKey('  payments:create:abc-1  ');
    expect(key).toBe('payments:create:abc-1');
    expect(asProviderIdempotencyKey(key)).toBe(key);
  });

  it('rejects empty, over-length, and control-character keys', () => {
    expect(() => asProviderIdempotencyKey('')).toThrow(/required/);
    expect(() =>
      asProviderIdempotencyKey('k'.repeat(PROVIDER_IDEMPOTENCY_KEY_MAX_LENGTH + 1)),
    ).toThrow(/at most/);
    expect(() => asProviderIdempotencyKey('key\u0007')).toThrow(/control characters/);
    try {
      asProviderIdempotencyKey('');
    } catch (error) {
      expect(error).toMatchObject({ code: PROVIDER_ERROR_CODES.INVALID_IDEMPOTENCY_KEY });
    }
  });
});
