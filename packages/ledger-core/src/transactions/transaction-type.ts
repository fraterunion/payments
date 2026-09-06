import { LEDGER_ERROR_CODES, LedgerError } from '../errors/errors.js';

export const LEDGER_TRANSACTION_TYPE_MAX_LENGTH = 64;
export const LEDGER_TRANSACTION_TYPE_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;
export const LEDGER_DESCRIPTION_MAX_LENGTH = 500;
export const LEDGER_REFERENCE_TYPE_MAX_LENGTH = 64;
export const LEDGER_REFERENCE_ID_MAX_LENGTH = 128;

export function canonicalizeLedgerTransactionType(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_TRANSACTION_TYPE,
      'Ledger transaction type is required.',
    );
  }
  const canonical = value.trim().toLowerCase();
  if (canonical.length > LEDGER_TRANSACTION_TYPE_MAX_LENGTH) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_TRANSACTION_TYPE,
      `Ledger transaction type must be at most ${LEDGER_TRANSACTION_TYPE_MAX_LENGTH} characters.`,
    );
  }
  if (!LEDGER_TRANSACTION_TYPE_PATTERN.test(canonical)) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_TRANSACTION_TYPE,
      'Ledger transaction type must be lowercase dot-separated tokens.',
    );
  }
  return canonical;
}

export function canonicalizeLedgerDescription(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const description = value.trim();
  if (description.length === 0) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_DESCRIPTION_INVALID,
      'Ledger description must be non-empty when provided.',
    );
  }
  if (description.length > LEDGER_DESCRIPTION_MAX_LENGTH) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_DESCRIPTION_INVALID,
      `Ledger description must be at most ${LEDGER_DESCRIPTION_MAX_LENGTH} characters.`,
    );
  }
  return description;
}

export type LedgerReference = {
  readonly type: string;
  readonly id: string;
};

export function canonicalizeLedgerReference(
  reference: LedgerReference | undefined,
): LedgerReference | undefined {
  if (reference === undefined) {
    return undefined;
  }
  const type = reference.type.trim().toLowerCase();
  const id = reference.id.trim();
  if (type.length === 0 || id.length === 0) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_REFERENCE,
      'Ledger reference type and id must both be present.',
    );
  }
  if (type.length > LEDGER_REFERENCE_TYPE_MAX_LENGTH || !/^[a-z][a-z0-9._-]*$/.test(type)) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_REFERENCE,
      'Ledger reference type must be a lowercase token.',
    );
  }
  if (id.length > LEDGER_REFERENCE_ID_MAX_LENGTH) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_REFERENCE,
      `Ledger reference id must be at most ${LEDGER_REFERENCE_ID_MAX_LENGTH} characters.`,
    );
  }
  return { type, id };
}
