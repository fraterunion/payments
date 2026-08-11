import type { RequestWithId } from '../../common/types/request-with-id.type';
import type { RequestContext } from '../types/request-context.type';

function normalizeHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Extracts the request-derived detail carried into audit records — never used for authorization decisions, only diagnostics. */
export function extractRequestContext(request: RequestWithId): RequestContext {
  const userAgent = normalizeHeader(request.headers['user-agent']);
  return {
    requestId: request.id,
    ...(request.ip !== undefined ? { ipAddress: request.ip } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
  };
}
