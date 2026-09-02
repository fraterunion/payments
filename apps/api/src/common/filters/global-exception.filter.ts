import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ERROR_CODES, type ErrorCode } from '../constants/error-codes.constants';
import { AppException } from '../exceptions/app.exception';
import type { ErrorEnvelope } from '../types/error-envelope.type';
import type { RequestWithId } from '../types/request-with-id.type';

interface ResolvedError {
  readonly status: number;
  readonly code: ErrorCode;
  readonly message: string;
  readonly details: ErrorEnvelope['error']['details'];
}

const STATUS_TO_CODE: ReadonlyMap<number, ErrorCode> = new Map([
  [HttpStatus.BAD_REQUEST, ERROR_CODES.BAD_REQUEST],
  [HttpStatus.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED],
  [HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN],
  [HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND],
  [HttpStatus.CONFLICT, ERROR_CODES.CONFLICT],
  [HttpStatus.PAYLOAD_TOO_LARGE, ERROR_CODES.PAYLOAD_TOO_LARGE],
  [HttpStatus.SERVICE_UNAVAILABLE, ERROR_CODES.DEPENDENCY_UNAVAILABLE],
]);

function codeForStatus(status: number): ErrorCode {
  return STATUS_TO_CODE.get(status) ?? ERROR_CODES.INTERNAL_ERROR;
}

function extractMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('message' in body)) {
    return undefined;
  }

  const message = (body as Record<'message', unknown>).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
    return message.join(' ');
  }
  return undefined;
}

/**
 * Catches every exception and normalizes it into a stable envelope. Never
 * forwards a raw stack trace, database error, or framework-internal detail
 * to the client; 5xx bodies are always the same generic message.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();
    const requestId = request.id;

    const resolved = this.resolve(exception);
    this.log(exception, resolved, requestId);

    const body: ErrorEnvelope = {
      error: {
        code: resolved.code,
        message: resolved.message,
        requestId,
        ...(resolved.details !== undefined ? { details: resolved.details } : {}),
      },
    };

    response.status(resolved.status).json(body);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (isEntityTooLarge(exception)) {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        code: ERROR_CODES.PAYLOAD_TOO_LARGE,
        message: 'Request body is too large.',
        details: undefined,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        return {
          status,
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'An unexpected error occurred.',
          details: undefined,
        };
      }

      return {
        status,
        code: codeForStatus(status),
        message: extractMessage(exception.getResponse()) ?? exception.message,
        details: undefined,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred.',
      details: undefined,
    };
  }

  private log(exception: unknown, resolved: ResolvedError, requestId: string): void {
    if (resolved.status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        { requestId, status: resolved.status, code: resolved.code, stack },
        'Unhandled error',
      );
      return;
    }

    this.logger.warn({ requestId, status: resolved.status, code: resolved.code }, 'Request failed');
  }
}

function isEntityTooLarge(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const status = 'status' in error ? error.status : undefined;
  const statusCode = 'statusCode' in error ? error.statusCode : undefined;
  const type = 'type' in error ? error.type : undefined;
  return status === 413 || statusCode === 413 || type === 'entity.too.large';
}
