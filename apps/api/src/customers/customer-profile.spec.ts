import {
  canonicalizeCustomerEmail,
  canonicalizeCustomerPhone,
  canonicalizeOptionalText,
} from './customer-profile';
import { CustomerValidationException } from './customer.exceptions';

describe('customer profile canonicalization', () => {
  it('lowercases and trims email without treating it as unique identity', () => {
    expect(canonicalizeCustomerEmail('  Ada@Example.COM  ')).toBe('ada@example.com');
  });

  it('rejects invalid or empty email', () => {
    expect(() => canonicalizeCustomerEmail('not-an-email')).toThrow(CustomerValidationException);
    expect(() => canonicalizeCustomerEmail('   ')).toThrow(CustomerValidationException);
  });

  it('accepts E.164 phones and rejects local or ambiguous numbers', () => {
    expect(canonicalizeCustomerPhone('+15551234567')).toBe('+15551234567');
    expect(() => canonicalizeCustomerPhone('5551234567')).toThrow(/E\.164/);
    expect(() => canonicalizeCustomerPhone('+0123')).toThrow(/E\.164/);
  });

  it('trims bounded display names', () => {
    expect(canonicalizeOptionalText('  Acme Gym  ', 'name', 200)).toBe('Acme Gym');
    expect(() => canonicalizeOptionalText('   ', 'name', 200)).toThrow(/non-empty/);
  });
});
