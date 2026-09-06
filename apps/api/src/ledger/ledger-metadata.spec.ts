import { assertSafeLedgerMetadata } from './ledger-metadata';

describe('ledger metadata', () => {
  it('accepts a bounded object without secrets', () => {
    expect(assertSafeLedgerMetadata({ source: 'test', reason: 'fixture' })).toEqual({
      source: 'test',
      reason: 'fixture',
    });
  });

  it('rejects secret-like keys', () => {
    expect(() => assertSafeLedgerMetadata({ apiKey: 'sk_live_secret' })).toThrow(/not allowed/);
    expect(() => assertSafeLedgerMetadata({ cvc: '123' })).toThrow(/not allowed/);
  });
});
