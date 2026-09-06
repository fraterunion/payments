import { describe, expect, it } from 'vitest';
import { LEDGER_ACCOUNT_TYPES, normalBalanceForAccountType } from '../accounts/account-type.js';
import { deriveLedgerBalance, ledgerBalanceToJSON } from './balance.js';

describe('signed ledger balance derivation', () => {
  it('derives an asset balance as debits minus credits', () => {
    const balance = deriveLedgerBalance({
      currency: 'USD',
      normalBalance: normalBalanceForAccountType(LEDGER_ACCOUNT_TYPES.ASSET),
      debitTotal: 10000n,
      creditTotal: 2500n,
    });
    expect(balance.amount).toBe(7500n);
    expect(ledgerBalanceToJSON(balance)).toEqual({ amount: '7500', currency: 'USD' });
  });

  it('derives liability, revenue, and equity as credits minus debits', () => {
    for (const type of [
      LEDGER_ACCOUNT_TYPES.LIABILITY,
      LEDGER_ACCOUNT_TYPES.REVENUE,
      LEDGER_ACCOUNT_TYPES.EQUITY,
    ]) {
      const balance = deriveLedgerBalance({
        currency: 'USD',
        normalBalance: normalBalanceForAccountType(type),
        debitTotal: 2500n,
        creditTotal: 10000n,
      });
      expect(balance.amount).toBe(7500n);
    }
  });

  it('derives an expense balance as debits minus credits', () => {
    const balance = deriveLedgerBalance({
      currency: 'MXN',
      normalBalance: normalBalanceForAccountType(LEDGER_ACCOUNT_TYPES.EXPENSE),
      debitTotal: 400n,
      creditTotal: 100n,
    });
    expect(balance.amount).toBe(300n);
    expect(balance.currency).toBe('MXN');
  });

  it('can be negative without using payment Money', () => {
    const balance = deriveLedgerBalance({
      currency: 'USD',
      normalBalance: normalBalanceForAccountType(LEDGER_ACCOUNT_TYPES.ASSET),
      debitTotal: 100n,
      creditTotal: 400n,
    });
    expect(balance.amount).toBe(-300n);
    expect(ledgerBalanceToJSON(balance).amount).toBe('-300');
  });
});
