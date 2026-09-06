import { LEDGER_ERROR_CODES, LedgerError } from '../errors/errors.js';
import { LEDGER_SIDES, type LedgerSide } from '../entries/side.js';

export const LEDGER_ACCOUNT_TYPES = {
  ASSET: 'ASSET',
  LIABILITY: 'LIABILITY',
  EQUITY: 'EQUITY',
  REVENUE: 'REVENUE',
  EXPENSE: 'EXPENSE',
} as const;

export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[keyof typeof LEDGER_ACCOUNT_TYPES];

export const LEDGER_ACCOUNT_STATUSES = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;

export type LedgerAccountStatus =
  (typeof LEDGER_ACCOUNT_STATUSES)[keyof typeof LEDGER_ACCOUNT_STATUSES];

const ACCOUNT_TYPES: ReadonlySet<string> = new Set(Object.values(LEDGER_ACCOUNT_TYPES));

export function isLedgerAccountType(value: string): value is LedgerAccountType {
  return ACCOUNT_TYPES.has(value);
}

export function asLedgerAccountType(value: string): LedgerAccountType {
  if (!isLedgerAccountType(value)) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_ACCOUNT_TYPE,
      'Ledger account type must be ASSET, LIABILITY, EQUITY, REVENUE, or EXPENSE.',
    );
  }
  return value;
}

/**
 * Normal balance is derived from type. V1 does not allow overrides.
 */
export function normalBalanceForAccountType(type: LedgerAccountType): LedgerSide {
  switch (type) {
    case LEDGER_ACCOUNT_TYPES.ASSET:
    case LEDGER_ACCOUNT_TYPES.EXPENSE:
      return LEDGER_SIDES.DEBIT;
    case LEDGER_ACCOUNT_TYPES.LIABILITY:
    case LEDGER_ACCOUNT_TYPES.EQUITY:
    case LEDGER_ACCOUNT_TYPES.REVENUE:
      return LEDGER_SIDES.CREDIT;
  }
}
