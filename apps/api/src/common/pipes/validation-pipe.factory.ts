import { ValidationPipe } from '@nestjs/common';
import { mapValidationErrors, ValidationException } from '../exceptions/validation.exception';

/**
 * Single source of truth for the global `ValidationPipe` configuration, so
 * `main.ts` and tests configure (and can verify) the exact same behavior.
 *
 * `whitelist` + `forbidNonWhitelisted` reject any field not declared on the
 * DTO; `transform` coerces primitives (query/param strings to number/boolean
 * etc.) but does not enable implicit type conversion beyond that, since
 * broader implicit conversion can silently accept malformed input.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) => new ValidationException(mapValidationErrors(errors)),
  });
}
