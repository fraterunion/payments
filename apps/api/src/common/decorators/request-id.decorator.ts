import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithId } from '../types/request-with-id.type';

/**
 * Injects the current request's correlation ID into a controller handler.
 * Exists so future audit-logging and domain operations can access it
 * without reaching into the raw request object.
 */
export const RequestId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    return request.id;
  },
);
