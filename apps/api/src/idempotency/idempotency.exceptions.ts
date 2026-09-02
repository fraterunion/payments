import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@fraterunion-payments/database';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes.constants';

export class IdempotencyKeyRequiredException extends AppException {
  constructor() {
    super(
      ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
      'Idempotency-Key is required.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class IdempotencyKeyInvalidException extends AppException {
  constructor(message: string) {
    super(ERROR_CODES.IDEMPOTENCY_KEY_INVALID, message, HttpStatus.BAD_REQUEST);
  }
}

export class IdempotencyKeyConflictException extends AppException {
  constructor() {
    super(
      ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT,
      'This idempotency key was already used with a different request.',
      HttpStatus.CONFLICT,
    );
  }
}

export class IdempotencyOperationInProgressException extends AppException {
  constructor() {
    super(
      ERROR_CODES.IDEMPOTENCY_OPERATION_IN_PROGRESS,
      'This operation is already in progress. Retry the same Idempotency-Key.',
      HttpStatus.CONFLICT,
    );
  }
}

export function isIdempotencyUnique(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = constraintTarget(error);
  return (
    target.includes('idempotency_records') ||
    target.includes('org_scope_key') ||
    target.includes('scope_resource') ||
    target.includes('key_hash') ||
    target.includes('keyhash')
  );
}

function constraintTarget(error: Prisma.PrismaClientKnownRequestError): string {
  const parts: string[] = [];
  const target = error.meta?.['target'];
  if (Array.isArray(target)) {
    parts.push(...target.map(String));
  } else if (typeof target === 'string') {
    parts.push(target);
  }
  const constraint = error.meta?.['constraint'];
  if (typeof constraint === 'string') {
    parts.push(constraint);
  }
  const fieldName = error.meta?.['field_name'];
  if (typeof fieldName === 'string') {
    parts.push(fieldName);
  }
  parts.push(error.message);
  return parts.join(' ').toLowerCase();
}
