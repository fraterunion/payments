import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  REQUEST_ID_MAX_LENGTH,
  REQUEST_ID_PATTERN,
} from '../constants/request-id.constants';
import type { RequestWithId } from '../types/request-with-id.type';

/**
 * Accepts an incoming `x-request-id` only if it is a conservative,
 * non-empty, bounded-length token; otherwise generates a fresh UUID.
 * Exported standalone so it can be unit tested without an HTTP server.
 */
export function resolveRequestId(headerValue: string | string[] | undefined): string {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (
    typeof candidate === 'string' &&
    candidate.length > 0 &&
    candidate.length <= REQUEST_ID_MAX_LENGTH &&
    REQUEST_ID_PATTERN.test(candidate)
  ) {
    return candidate;
  }

  return randomUUID();
}

/**
 * Registered via `app.use()` (not Nest's `MiddlewareConsumer`) so it runs
 * for every request the HTTP server receives, including ones that match no
 * controller at all — Nest's own 404 handling for unmatched routes happens
 * downstream of Express-level middleware, but is not guaranteed to be
 * reached by module-scoped `forRoutes('*')` middleware.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  (req as RequestWithId).id = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
