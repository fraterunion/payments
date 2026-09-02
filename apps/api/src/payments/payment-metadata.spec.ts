import { assertSafePaymentMetadata } from './payment-metadata';
import { PAYMENT_METADATA_MAX_BYTES } from './payment.types';

describe('payment metadata', () => {
  it('accepts a small JSON object', () => {
    expect(assertSafePaymentMetadata({ orderId: 'ord-1' })).toEqual({ orderId: 'ord-1' });
  });

  it('rejects secret-bearing keys and oversized payloads', () => {
    expect(() => assertSafePaymentMetadata({ password: 'secret' })).toThrow(/not allowed/);
    expect(() => assertSafePaymentMetadata({ pan: '4111111111111111' })).toThrow(/not allowed/);
    expect(() => assertSafePaymentMetadata({ cvc: '123' })).toThrow(/not allowed/);
    expect(() => assertSafePaymentMetadata({ authorization: 'Bearer x' })).toThrow(/not allowed/);
    expect(() => assertSafePaymentMetadata({ apiKey: 'fup_test' })).toThrow(/not allowed/);
    expect(() =>
      assertSafePaymentMetadata({ note: 'x'.repeat(PAYMENT_METADATA_MAX_BYTES + 1) }),
    ).toThrow(/exceeds/);
  });
});
