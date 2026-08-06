import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '../constants/error-codes.constants';
import type { ErrorDetail } from '../types/error-envelope.type';

/**
 * Base for exceptions that should surface a stable `code` through
 * `GlobalExceptionFilter`, instead of the filter having to infer one from
 * an HTTP status or NestJS's default error shape.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: readonly ErrorDetail[];

  constructor(
    code: ErrorCode,
    message: string,
    status: HttpStatus,
    details?: readonly ErrorDetail[],
  ) {
    super(message, status);
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
