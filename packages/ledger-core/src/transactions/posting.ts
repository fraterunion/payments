import { asLedgerSide, LEDGER_SIDES, type LedgerSide } from '../entries/side.js';
import { LEDGER_ERROR_CODES, LedgerError } from '../errors/errors.js';

export const LEDGER_MIN_ENTRY_COUNT = 2;

export type LedgerPostingLine = {
  readonly accountId: string;
  readonly side: LedgerSide;
  readonly amount: bigint;
};

export type ValidatedLedgerPosting = {
  readonly entries: readonly LedgerPostingLine[];
  readonly debitTotal: bigint;
  readonly creditTotal: bigint;
};

export function assertPositiveLedgerAmount(amount: bigint): bigint {
  if (typeof amount !== 'bigint') {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_AMOUNT,
      'Ledger amount must be a bigint integer in minor units.',
    );
  }
  if (amount <= 0n) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_AMOUNT,
      'Ledger amount must be greater than zero.',
    );
  }
  return amount;
}

export function canonicalizeLedgerPostingLines(
  entries: readonly {
    readonly accountId: string;
    readonly side: string;
    readonly amount: bigint;
  }[],
): ValidatedLedgerPosting {
  if (entries.length < LEDGER_MIN_ENTRY_COUNT) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_TRANSACTION_TOO_FEW_ENTRIES,
      'A ledger transaction must contain at least two entries.',
    );
  }

  const canonical: LedgerPostingLine[] = entries.map((entry) => {
    const accountId = entry.accountId.trim();
    if (accountId.length === 0) {
      throw new LedgerError(
        LEDGER_ERROR_CODES.LEDGER_ACCOUNT_NOT_FOUND,
        'Ledger entry accountId is required.',
      );
    }
    return {
      accountId,
      side: asLedgerSide(entry.side),
      amount: assertPositiveLedgerAmount(entry.amount),
    };
  });

  let debitTotal = 0n;
  let creditTotal = 0n;
  for (const entry of canonical) {
    if (entry.side === LEDGER_SIDES.DEBIT) {
      debitTotal += entry.amount;
    } else {
      creditTotal += entry.amount;
    }
  }

  if (debitTotal !== creditTotal) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_TRANSACTION_UNBALANCED,
      'Ledger transaction debits must equal credits.',
    );
  }

  return { entries: Object.freeze(canonical), debitTotal, creditTotal };
}

/**
 * Deterministic order for fingerprinting. Persisted insert order is not
 * economically meaningful.
 */
export function sortLedgerPostingLines(
  entries: readonly LedgerPostingLine[],
): readonly LedgerPostingLine[] {
  return [...entries].sort((left, right) => {
    if (left.accountId !== right.accountId) {
      return left.accountId < right.accountId ? -1 : 1;
    }
    if (left.side !== right.side) {
      return left.side < right.side ? -1 : 1;
    }
    if (left.amount !== right.amount) {
      return left.amount < right.amount ? -1 : 1;
    }
    return 0;
  });
}
