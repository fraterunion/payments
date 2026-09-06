import { describe, expect, it } from 'vitest';
import { LEDGER_SIDES } from '../entries/side.js';
import {
  LEDGER_ACCOUNT_TYPES,
  asLedgerAccountType,
  normalBalanceForAccountType,
} from './account-type.js';

describe('ledger account types', () => {
  it('maps debit-normal types', () => {
    expect(normalBalanceForAccountType(LEDGER_ACCOUNT_TYPES.ASSET)).toBe(LEDGER_SIDES.DEBIT);
    expect(normalBalanceForAccountType(LEDGER_ACCOUNT_TYPES.EXPENSE)).toBe(LEDGER_SIDES.DEBIT);
  });

  it('maps credit-normal types', () => {
    expect(normalBalanceForAccountType(LEDGER_ACCOUNT_TYPES.LIABILITY)).toBe(LEDGER_SIDES.CREDIT);
    expect(normalBalanceForAccountType(LEDGER_ACCOUNT_TYPES.EQUITY)).toBe(LEDGER_SIDES.CREDIT);
    expect(normalBalanceForAccountType(LEDGER_ACCOUNT_TYPES.REVENUE)).toBe(LEDGER_SIDES.CREDIT);
  });

  it('rejects unknown account types', () => {
    expect(() => asLedgerAccountType('STRIPE_CLEARING')).toThrow(/ASSET/);
  });
});
