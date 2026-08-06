import { HttpStatus } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { AppException } from './app.exception';
import type { ErrorDetail } from '../types/error-envelope.type';

/** Thrown by the global `ValidationPipe`'s `exceptionFactory`. */
export class ValidationException extends AppException {
  constructor(details: readonly ErrorDetail[]) {
    super('VALIDATION_ERROR', 'Request validation failed.', HttpStatus.BAD_REQUEST, details);
  }
}

/**
 * Flattens class-validator's (possibly nested, via `children`) errors into
 * the flat `{ field, message }[]` shape `ErrorEnvelope` exposes. Field names
 * for nested properties are dot-joined (e.g. `address.postalCode`).
 */
export function mapValidationErrors(
  errors: readonly ValidationError[],
  parentPath = '',
): ErrorDetail[] {
  return errors.flatMap((error) => {
    const field = parentPath === '' ? error.property : `${parentPath}.${error.property}`;
    const ownDetails = Object.values(error.constraints ?? {}).map((message): ErrorDetail => ({
      field,
      message,
    }));
    const childDetails =
      error.children !== undefined && error.children.length > 0
        ? mapValidationErrors(error.children, field)
        : [];

    return [...ownDetails, ...childDetails];
  });
}
