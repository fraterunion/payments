import type { Request } from 'express';

/**
 * An Express request after `RequestIdMiddleware` has run. `id` is only safe
 * to read (or, in that middleware, set) on requests that passed through
 * it — i.e. every request reaching a controller or exception filter.
 */
export interface RequestWithId extends Request {
  id: string;
}
