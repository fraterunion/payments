import { canonicalizeLedgerCurrency } from '../currency.js';
import { LEDGER_SIDES, type LedgerSide } from '../entries/side.js';

/**
 * Signed account balance in minor units. Unlike payment Money, this may
 * be negative when an account is opposite its normal balance.
 */
export type LedgerBalance = {
  readonly amount: bigint;
  readonly currency: string;
};

export type LedgerBalanceJSON = {
  readonly amount: string;
  readonly currency: string;
};

export function createLedgerBalance(amount: bigint, currency: string): LedgerBalance {
  if (typeof amount !== 'bigint') {
    throw new TypeError('Ledger balance amount must be a bigint.');
  }
  return Object.freeze({
    amount,
    currency: canonicalizeLedgerCurrency(currency),
  });
}

export function ledgerBalanceToJSON(balance: LedgerBalance): LedgerBalanceJSON {
  return {
    amount: balance.amount.toString(10),
    currency: balance.currency,
  };
}

export function deriveLedgerBalance(input: {
  readonly currency: string;
  readonly normalBalance: LedgerSide;
  readonly debitTotal: bigint;
  readonly creditTotal: bigint;
}): LedgerBalance {
  const signed =
    input.normalBalance === LEDGER_SIDES.DEBIT
      ? input.debitTotal - input.creditTotal
      : input.creditTotal - input.debitTotal;
  return createLedgerBalance(signed, input.currency);
}
