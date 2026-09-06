export const LEDGER_APPLICATION_ERROR_CODES = {
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_INVALID: 'IDEMPOTENCY_KEY_INVALID',
  IDEMPOTENCY_KEY_CONFLICT: 'IDEMPOTENCY_KEY_CONFLICT',
  IDEMPOTENCY_OPERATION_IN_PROGRESS: 'IDEMPOTENCY_OPERATION_IN_PROGRESS',
  LEDGER_CONCURRENCY_CONFLICT: 'LEDGER_CONCURRENCY_CONFLICT',
} as const;

export type LedgerApplicationErrorCode =
  (typeof LEDGER_APPLICATION_ERROR_CODES)[keyof typeof LEDGER_APPLICATION_ERROR_CODES];

export class LedgerApplicationError extends Error {
  readonly code: LedgerApplicationErrorCode;

  constructor(code: LedgerApplicationErrorCode, message: string) {
    super(message);
    this.name = 'LedgerApplicationError';
    this.code = code;
  }
}

export function isLedgerApplicationError(error: unknown): error is LedgerApplicationError {
  return error instanceof LedgerApplicationError;
}
