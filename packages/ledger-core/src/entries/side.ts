import { LEDGER_ERROR_CODES, LedgerError } from '../errors/errors.js';

export const LEDGER_SIDES = {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT',
} as const;

export type LedgerSide = (typeof LEDGER_SIDES)[keyof typeof LEDGER_SIDES];

const SIDES: ReadonlySet<string> = new Set(Object.values(LEDGER_SIDES));

export function isLedgerSide(value: string): value is LedgerSide {
  return SIDES.has(value);
}

export function asLedgerSide(value: string): LedgerSide {
  if (!isLedgerSide(value)) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_SIDE,
      'Ledger side must be DEBIT or CREDIT.',
    );
  }
  return value;
}
