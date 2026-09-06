import { LEDGER_ERROR_CODES, LedgerError } from '../errors/errors.js';

export const LEDGER_ACCOUNT_CODE_MAX_LENGTH = 64;
export const LEDGER_ACCOUNT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;
export const LEDGER_ACCOUNT_NAME_MAX_LENGTH = 200;

/**
 * Organization-scoped accounting identity. Canonical form is uppercase.
 */
export function canonicalizeLedgerAccountCode(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_ACCOUNT_CODE_INVALID,
      'Ledger account code is required.',
    );
  }
  const canonical = value.trim().toUpperCase();
  if (canonical.length > LEDGER_ACCOUNT_CODE_MAX_LENGTH) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_ACCOUNT_CODE_INVALID,
      `Ledger account code must be at most ${LEDGER_ACCOUNT_CODE_MAX_LENGTH} characters.`,
    );
  }
  if (!LEDGER_ACCOUNT_CODE_PATTERN.test(canonical)) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_ACCOUNT_CODE_INVALID,
      'Ledger account code must match [A-Z0-9][A-Z0-9._-]*.',
    );
  }
  return canonical;
}

export function canonicalizeLedgerAccountName(value: string): string {
  const name = value.trim();
  if (name.length === 0) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_ACCOUNT_CODE_INVALID,
      'Ledger account name is required.',
    );
  }
  if (name.length > LEDGER_ACCOUNT_NAME_MAX_LENGTH) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_ACCOUNT_CODE_INVALID,
      `Ledger account name must be at most ${LEDGER_ACCOUNT_NAME_MAX_LENGTH} characters.`,
    );
  }
  return name;
}
