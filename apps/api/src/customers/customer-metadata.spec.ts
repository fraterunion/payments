import { assertSafeCustomerMetadata } from './customer-metadata';
import { CUSTOMER_METADATA_MAX_BYTES } from './customer.types';

describe('customer metadata', () => {
  it('accepts a small JSON object', () => {
    expect(assertSafeCustomerMetadata({ memberTier: 'gold' })).toEqual({ memberTier: 'gold' });
  });

  it('rejects secret-bearing keys and oversized payloads', () => {
    expect(() => assertSafeCustomerMetadata({ password: 'secret' })).toThrow(/not allowed/);
    expect(() => assertSafeCustomerMetadata({ pan: '4111111111111111' })).toThrow(/not allowed/);
    expect(() =>
      assertSafeCustomerMetadata({ note: 'x'.repeat(CUSTOMER_METADATA_MAX_BYTES + 1) }),
    ).toThrow(/exceeds/);
  });
});
