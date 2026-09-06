import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@fraterunion-payments/database';
import { isLedgerApplicationError } from '@fraterunion-payments/ledger-application';
import { isLedgerError } from '@fraterunion-payments/ledger-core';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES, type ErrorCode } from '../common/constants/error-codes.constants';
import { isIdempotencyUnique as isFinancialIdempotencyUnique } from '../idempotency/idempotency.exceptions';

export {
  IdempotencyKeyConflictException,
  IdempotencyKeyInvalidException,
  IdempotencyKeyRequiredException,
} from '../idempotency/idempotency.exceptions';

export class LedgerException extends AppException {
  constructor(code: ErrorCode, message: string, status: HttpStatus) {
    super(code, message, status);
  }
}

export class LedgerAccountNotFoundException extends LedgerException {
  constructor() {
    super(
      ERROR_CODES.LEDGER_ACCOUNT_NOT_FOUND,
      'Ledger account was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class LedgerTransactionNotFoundException extends LedgerException {
  constructor() {
    super(
      ERROR_CODES.LEDGER_TRANSACTION_NOT_FOUND,
      'Ledger transaction was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class LedgerConcurrencyConflictException extends LedgerException {
  constructor() {
    super(
      ERROR_CODES.LEDGER_CONCURRENCY_CONFLICT,
      'The ledger command could not be completed because of a concurrent change.',
      HttpStatus.CONFLICT,
    );
  }
}

export function mapLedgerDomainError(error: unknown): LedgerException | undefined {
  if (isLedgerApplicationError(error)) {
    const status =
      error.code === 'IDEMPOTENCY_KEY_CONFLICT' ||
      error.code === 'IDEMPOTENCY_OPERATION_IN_PROGRESS' ||
      error.code === 'LEDGER_CONCURRENCY_CONFLICT'
        ? HttpStatus.CONFLICT
        : HttpStatus.BAD_REQUEST;
    return new LedgerException(ERROR_CODES[error.code], error.message, status);
  }
  if (!isLedgerError(error)) {
    return undefined;
  }
  switch (error.code) {
    case 'LEDGER_ACCOUNT_NOT_FOUND':
    case 'LEDGER_TRANSACTION_NOT_FOUND':
      return new LedgerException(ERROR_CODES[error.code], error.message, HttpStatus.NOT_FOUND);
    case 'LEDGER_ACCOUNT_CODE_CONFLICT':
    case 'LEDGER_ACCOUNT_ARCHIVED':
    case 'LEDGER_ACCOUNT_BOUND':
    case 'LEDGER_CROSS_TENANT_ACCOUNT':
    case 'LEDGER_INVALID_REVERSAL':
    case 'LEDGER_BINDING_ROLE_MISMATCH':
    case 'LEDGER_BINDING_CURRENCY_MISMATCH':
    case 'LEDGER_BINDING_CONFLICT':
      return new LedgerException(ERROR_CODES[error.code], error.message, HttpStatus.CONFLICT);
    default:
      return new LedgerException(
        ERROR_CODES[error.code] ?? ERROR_CODES.VALIDATION_ERROR,
        error.message,
        HttpStatus.BAD_REQUEST,
      );
  }
}

export function isIdempotencyUnique(error: unknown): boolean {
  return isFinancialIdempotencyUnique(error);
}

export function isLedgerAccountCodeUnique(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = `${JSON.stringify(error.meta ?? {})} ${error.message}`.toLowerCase();
  return target.includes('ledger_accounts_org_code') || target.includes('code');
}
