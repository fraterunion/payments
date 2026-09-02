import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@fraterunion-payments/database';
import { isPaymentDomainError } from '@fraterunion-payments/payment-core';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES, type ErrorCode } from '../common/constants/error-codes.constants';
import { isIdempotencyUnique } from '../idempotency/idempotency.exceptions';
import { InvalidPaymentAmountException } from '../payments/payment.exceptions';

export class RefundException extends AppException {
  constructor(code: ErrorCode, message: string, status: HttpStatus) {
    super(code, message, status);
  }
}

export class RefundNotFoundException extends RefundException {
  constructor() {
    super(ERROR_CODES.REFUND_NOT_FOUND, 'Refund was not found.', HttpStatus.NOT_FOUND);
  }
}

export class RefundPaymentNotFoundException extends RefundException {
  constructor() {
    super(ERROR_CODES.REFUND_PAYMENT_NOT_FOUND, 'Payment was not found.', HttpStatus.NOT_FOUND);
  }
}

export class PaymentNotRefundableException extends RefundException {
  constructor() {
    super(
      ERROR_CODES.PAYMENT_NOT_REFUNDABLE,
      'This payment cannot accept a refund in its current state.',
      HttpStatus.CONFLICT,
    );
  }
}

export class RefundAmountExceedsAvailableException extends RefundException {
  constructor() {
    super(
      ERROR_CODES.REFUND_AMOUNT_EXCEEDS_AVAILABLE,
      'The refund amount exceeds available captured funds after reservations.',
      HttpStatus.CONFLICT,
    );
  }
}

export class RefundValidationException extends RefundException {
  constructor(message: string) {
    super(ERROR_CODES.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST);
  }
}

export class RefundConcurrencyConflictException extends RefundException {
  constructor() {
    super(
      ERROR_CODES.REFUND_CONCURRENCY_CONFLICT,
      'The refund could not be updated because of a concurrent change.',
      HttpStatus.CONFLICT,
    );
  }
}

export function mapRefundDomainError(error: unknown): RefundException | undefined {
  if (!isPaymentDomainError(error)) {
    return undefined;
  }

  switch (error.code) {
    case 'REFUND_EXCEEDS_CAPTURED_AMOUNT':
      return new RefundAmountExceedsAvailableException();
    case 'INVALID_REFUND':
      return new RefundException(
        ERROR_CODES.REFUND_INVALID_TRANSITION,
        error.message,
        HttpStatus.CONFLICT,
      );
    case 'INVALID_PAYMENT_TRANSITION':
    case 'INVALID_PAYMENT_OPERATION':
      return new PaymentNotRefundableException();
    case 'ZERO_AMOUNT_NOT_ALLOWED':
    case 'INVALID_PAYMENT_AMOUNT':
      return new InvalidPaymentAmountException(error.message);
    case 'INVALID_CURRENCY':
    case 'INVALID_MONEY':
    case 'CURRENCY_MISMATCH':
    case 'INVALID_IDENTIFIER':
    case 'INVALID_PAYMENT_FAILURE':
      return new RefundValidationException(error.message);
    default:
      return new RefundValidationException(error.message);
  }
}

export function mapRefundPrismaError(error: unknown): RefundException | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }
  if (error.code === 'P2002' && isIdempotencyUnique(error)) {
    return undefined;
  }
  if (error.code === 'P2003' || error.code === 'P2025') {
    return new RefundPaymentNotFoundException();
  }
  return undefined;
}

export { isIdempotencyUnique };
