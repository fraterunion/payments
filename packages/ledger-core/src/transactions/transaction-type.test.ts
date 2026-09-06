import { describe, expect, it } from 'vitest';
import {
  canonicalizeLedgerDescription,
  canonicalizeLedgerReference,
  canonicalizeLedgerTransactionType,
} from './transaction-type.js';

describe('ledger transaction type and reference', () => {
  it('canonicalizes lowercase dot-separated types', () => {
    expect(canonicalizeLedgerTransactionType('Test.Posting')).toBe('test.posting');
  });

  it('rejects empty and illegal types', () => {
    expect(() => canonicalizeLedgerTransactionType('')).toThrow(/required/);
    expect(() => canonicalizeLedgerTransactionType('payment capture')).toThrow(/dot-separated/);
  });

  it('requires both reference fields when a reference is supplied', () => {
    expect(canonicalizeLedgerReference({ type: 'Test', id: ' id-1 ' })).toEqual({
      type: 'test',
      id: 'id-1',
    });
    expect(() => canonicalizeLedgerReference({ type: '', id: 'id-1' })).toThrow(/both be present/);
  });

  it('rejects a blank description', () => {
    expect(canonicalizeLedgerDescription(' Sale ')).toBe('Sale');
    expect(() => canonicalizeLedgerDescription('   ')).toThrow(/non-empty/);
  });
});
