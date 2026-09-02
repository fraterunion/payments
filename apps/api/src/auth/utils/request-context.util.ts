import { AUDIT_USER_AGENT_MAX_LENGTH } from '../../audit/audit.types';
import type { RequestWithId } from '../../common/types/request-with-id.type';
import type { RequestContext } from '../types/request-context.type';

function normalizeHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Safe request-derived audit context. Never copies Authorization, cookies,
 * or other headers. User-Agent is bounded to the database column length.
 * Not used for authorization.
 */
export function extractRequestContext(request: RequestWithId): RequestContext {
  const rawUserAgent = normalizeHeader(request.headers['user-agent']);
  const userAgent =
    rawUserAgent === undefined ? undefined : rawUserAgent.slice(0, AUDIT_USER_AGENT_MAX_LENGTH);
  return {
    requestId: request.id,
    ...(request.ip !== undefined ? { ipAddress: request.ip } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
  };
}
