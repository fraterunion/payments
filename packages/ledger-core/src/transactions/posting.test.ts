import { describe, expect, it } from 'vitest';
import { LEDGER_ERROR_CODES, isLedgerError } from '../errors/errors.js';
import { canonicalizeLedgerPostingLines, sortLedgerPostingLines } from './posting.js';

function expectLedgerCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error('expected ledger error');
  } catch (error) {
    expect(isLedgerError(error) && error.code).toBe(code);
  }
}

const cash = 'acct-cash';
const revenue = 'acct-rev';

describe('ledger posting validation', () => {
  it('accepts a balanced two-line journal', () => {
    const posting = canonicalizeLedgerPostingLines([
      { accountId: cash, side: 'DEBIT', amount: 10000n },
      { accountId: revenue, side: 'CREDIT', amount: 10000n },
    ]);
    expect(posting.debitTotal).toBe(10000n);
    expect(posting.creditTotal).toBe(10000n);
  });

  it('rejects too few entries, zero, and negative amounts', () => {
    expectLedgerCode(
      () => canonicalizeLedgerPostingLines([{ accountId: cash, side: 'DEBIT', amount: 100n }]),
      LEDGER_ERROR_CODES.LEDGER_TRANSACTION_TOO_FEW_ENTRIES,
    );
    expectLedgerCode(
      () =>
        canonicalizeLedgerPostingLines([
          { accountId: cash, side: 'DEBIT', amount: 0n },
          { accountId: revenue, side: 'CREDIT', amount: 0n },
        ]),
      LEDGER_ERROR_CODES.LEDGER_INVALID_AMOUNT,
    );
    expectLedgerCode(
      () =>
        canonicalizeLedgerPostingLines([
          { accountId: cash, side: 'DEBIT', amount: -1n },
          { accountId: revenue, side: 'CREDIT', amount: 1n },
        ]),
      LEDGER_ERROR_CODES.LEDGER_INVALID_AMOUNT,
    );
  });

  it('rejects unbalanced journals', () => {
    expectLedgerCode(
      () =>
        canonicalizeLedgerPostingLines([
          { accountId: cash, side: 'DEBIT', amount: 100n },
          { accountId: revenue, side: 'CREDIT', amount: 90n },
        ]),
      LEDGER_ERROR_CODES.LEDGER_TRANSACTION_UNBALANCED,
    );
  });

  it('allows the same account on both sides', () => {
    const posting = canonicalizeLedgerPostingLines([
      { accountId: cash, side: 'DEBIT', amount: 50n },
      { accountId: cash, side: 'CREDIT', amount: 50n },
    ]);
    expect(posting.debitTotal).toBe(50n);
  });

  it('sorts entries by account, side, and amount', () => {
    const sorted = sortLedgerPostingLines([
      { accountId: 'b', side: 'CREDIT', amount: 2n },
      { accountId: 'a', side: 'CREDIT', amount: 1n },
      { accountId: 'a', side: 'DEBIT', amount: 3n },
    ]);
    expect(sorted.map((entry) => `${entry.accountId}:${entry.side}:${entry.amount}`)).toEqual([
      'a:CREDIT:1',
      'a:DEBIT:3',
      'b:CREDIT:2',
    ]);
  });
});
