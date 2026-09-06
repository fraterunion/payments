import { describe, expect, it } from 'vitest';
import { canonicalizeLedgerAccountCode, canonicalizeLedgerAccountName } from './account-code.js';

describe('ledger account codes', () => {
  it('canonicalizes to uppercase', () => {
    expect(canonicalizeLedgerAccountCode('cash.operating')).toBe('CASH.OPERATING');
    expect(canonicalizeLedgerAccountCode(' 1000 ')).toBe('1000');
  });

  it('rejects empty, oversized, and illegal characters', () => {
    expect(() => canonicalizeLedgerAccountCode('')).toThrow(/required/);
    expect(() => canonicalizeLedgerAccountCode('A'.repeat(65))).toThrow(/at most/);
    expect(() => canonicalizeLedgerAccountCode('cash/operating')).toThrow(/match/);
  });

  it('requires a non-empty bounded name', () => {
    expect(canonicalizeLedgerAccountName('  Cash  ')).toBe('Cash');
    expect(() => canonicalizeLedgerAccountName('   ')).toThrow(/required/);
  });
});
