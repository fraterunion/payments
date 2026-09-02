import { assertSafeRefundMetadata } from './refund-metadata';

describe('refund metadata', () => {
  it('accepts a bounded object and rejects secret keys', () => {
    expect(assertSafeRefundMetadata({ ticket: '123' })).toEqual({ ticket: '123' });
    expect(() => assertSafeRefundMetadata({ password: 'nope' })).toThrow(/not allowed/);
    expect(() => assertSafeRefundMetadata({ pan: '4111111111111111' })).toThrow(/not allowed/);
    expect(() => assertSafeRefundMetadata({ cvc: '123' })).toThrow(/not allowed/);
  });

  it('rejects oversized payloads', () => {
    expect(() => assertSafeRefundMetadata({ note: 'x'.repeat(20_000) })).toThrow(/UTF-8 bytes/);
  });
});
