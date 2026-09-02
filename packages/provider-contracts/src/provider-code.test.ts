import { describe, expect, it } from 'vitest';
import { PROVIDER_ERROR_CODES } from './errors.js';
import {
  asPaymentProviderCode,
  isPaymentProviderCode,
  PROVIDER_CODE_MAX_LENGTH,
} from './provider-code.js';

describe('PaymentProviderCode', () => {
  it('canonicalizes to lowercase', () => {
    expect(asPaymentProviderCode('Example')).toBe('example');
    expect(asPaymentProviderCode('  ACME_1  ')).toBe('acme_1');
  });

  it('accepts [a-z0-9_-]', () => {
    expect(asPaymentProviderCode('adyen')).toBe('adyen');
    expect(asPaymentProviderCode('foo-bar_2')).toBe('foo-bar_2');
  });

  it('rejects empty, invalid characters, and over-length codes', () => {
    expect(() => asPaymentProviderCode('')).toThrow(/required/);
    expect(() => asPaymentProviderCode('   ')).toThrow(/required/);
    expect(() => asPaymentProviderCode('acme!')).toThrow(/lowercase/);
    expect(() => asPaymentProviderCode('ac me')).toThrow(/lowercase/);
    expect(() => asPaymentProviderCode('a'.repeat(PROVIDER_CODE_MAX_LENGTH + 1))).toThrow(
      /at most/,
    );
    try {
      asPaymentProviderCode('');
    } catch (error) {
      expect(error).toMatchObject({ code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_CODE });
    }
  });

  it('reports membership through isPaymentProviderCode', () => {
    expect(isPaymentProviderCode('example')).toBe(true);
    expect(isPaymentProviderCode('Nope!')).toBe(false);
  });
});
