import { LEDGER_ERROR_CODES, LedgerError } from './errors/errors.js';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Uppercase ISO 4217 alphabetic shape. Listed payment-code membership is
 * an application concern so this package stays payment-provider agnostic.
 */
export function canonicalizeLedgerCurrency(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_CURRENCY_INVALID,
      'Ledger currency is required.',
    );
  }
  const canonical = value.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(canonical)) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_CURRENCY_INVALID,
      'Ledger currency must be exactly three ASCII letters (ISO 4217).',
    );
  }
  return canonical;
}

export function assertSameLedgerCurrency(left: string, right: string): void {
  if (left !== right) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_CURRENCY_MISMATCH,
      `Ledger currency mismatch: ${left} vs ${right}.`,
    );
  }
}
