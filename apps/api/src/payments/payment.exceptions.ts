import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@fraterunion-payments/database';
import { isPaymentDomainError } from '@fraterunion-payments/payment-core';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES, type ErrorCode } from '../common/constants/error-codes.constants';

export class PaymentException extends AppException {
  constructor(code: ErrorCode, message: string, status: HttpStatus) {
    super(code, message, status);
  }
}

export class PaymentNotFoundException extends PaymentException {
  constructor() {
    super(ERROR_CODES.PAYMENT_NOT_FOUND, 'Payment was not found.', HttpStatus.NOT_FOUND);
  }
}

export class PaymentCustomerNotFoundException extends PaymentException {
  constructor() {
    super(ERROR_CODES.PAYMENT_CUSTOMER_NOT_FOUND, 'Customer was not found.', HttpStatus.NOT_FOUND);
  }
}

export class PaymentCustomerArchivedException extends PaymentException {
  constructor() {
    super(
      ERROR_CODES.PAYMENT_CUSTOMER_ARCHIVED,
      'Archived customers cannot receive new payments.',
      HttpStatus.CONFLICT,
    );
  }
}

export class PaymentValidationException extends PaymentException {
  constructor(message: string) {
    super(ERROR_CODES.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST);
  }
}

export class InvalidPaymentAmountException extends PaymentException {
  constructor(message: string) {
    super(ERROR_CODES.INVALID_PAYMENT_AMOUNT, message, HttpStatus.BAD_REQUEST);
  }
}

export class IdempotencyKeyRequiredException extends PaymentException {
  constructor() {
    super(
      ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
      'Idempotency-Key is required for payment creation.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class IdempotencyKeyInvalidException extends PaymentException {
  constructor(message: string) {
    super(ERROR_CODES.IDEMPOTENCY_KEY_INVALID, message, HttpStatus.BAD_REQUEST);
  }
}

export class IdempotencyKeyConflictException extends PaymentException {
  constructor() {
    super(
      ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT,
      'This idempotency key was already used with a different payment request.',
      HttpStatus.CONFLICT,
    );
  }
}

export class PaymentConcurrencyConflictException extends PaymentException {
  constructor() {
    super(
      ERROR_CODES.PAYMENT_CONCURRENCY_CONFLICT,
      'The payment could not be updated because of a concurrent change.',
      HttpStatus.CONFLICT,
    );
  }
}

export function mapPaymentDomainError(error: unknown): PaymentException | undefined {
  if (!isPaymentDomainError(error)) {
    return undefined;
  }

  switch (error.code) {
    case 'INVALID_PAYMENT_TRANSITION':
    case 'INVALID_PAYMENT_OPERATION':
      return new PaymentException(
        ERROR_CODES.PAYMENT_INVALID_TRANSITION,
        error.message,
        HttpStatus.CONFLICT,
      );
    case 'INVALID_PAYMENT_AMOUNT':
    case 'ZERO_AMOUNT_NOT_ALLOWED':
    case 'AUTHORIZATION_EXCEEDS_REQUESTED_AMOUNT':
    case 'CAPTURE_EXCEEDS_AUTHORIZED_AMOUNT':
    case 'REFUND_EXCEEDS_CAPTURED_AMOUNT':
      return new InvalidPaymentAmountException(error.message);
    case 'INVALID_CURRENCY':
    case 'INVALID_MONEY':
    case 'CURRENCY_MISMATCH':
      return new PaymentValidationException(error.message);
    case 'INVALID_IDENTIFIER':
      return new PaymentValidationException(error.message);
    case 'INVALID_PAYMENT_FAILURE':
      return new PaymentValidationException(error.message);
    default:
      return new PaymentValidationException(error.message);
  }
}

export function mapPaymentPrismaError(error: unknown): PaymentException | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }

  if (error.code === 'P2002' && isIdempotencyUnique(error)) {
    return undefined;
  }

  if (error.code === 'P2003' || error.code === 'P2025') {
    const target = constraintTarget(error);
    if (target.includes('customer')) {
      return new PaymentCustomerNotFoundException();
    }
  }

  return undefined;
}

export function isIdempotencyUnique(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = constraintTarget(error);
  return (
    target.includes('payment_create_idempotency') ||
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
