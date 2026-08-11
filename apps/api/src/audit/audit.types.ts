import type { Prisma } from '@fraterunion-payments/database';

/**
 * Minimum action vocabulary this commit's authentication flows must record
 * (see docs/architecture/authentication-and-access-control.md). Not an
 * exhaustive audit taxonomy — future domains add their own actions here as
 * they're implemented, not speculatively now.
 */
export const AUDIT_ACTIONS = {
  AUTH_REGISTERED: 'auth.registered',
  AUTH_LOGIN_SUCCEEDED: 'auth.login_succeeded',
  AUTH_SESSION_REFRESHED: 'auth.session_refreshed',
  AUTH_SESSION_REVOKED: 'auth.session_revoked',
  AUTH_ALL_SESSIONS_REVOKED: 'auth.all_sessions_revoked',
  AUTH_REFRESH_REUSE_DETECTED: 'auth.refresh_reuse_detected',
  API_KEY_CREATED: 'api_key.created',
  API_KEY_REVOKED: 'api_key.revoked',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_RESOURCE_TYPES = {
  ORGANIZATION: 'organization',
  USER: 'user',
  SESSION: 'session',
  API_KEY: 'api_key',
} as const;

export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[keyof typeof AUDIT_RESOURCE_TYPES];

/**
 * Who performed the audited action. `system` covers events with no human or
 * API-key actor (none are recorded by this commit's flows, but the type
 * exists so future system-initiated events don't need a schema change).
 */
export type AuditActor =
  | { readonly type: 'user'; readonly userId: string }
  | { readonly type: 'api_key'; readonly apiKeyId: string }
  | { readonly type: 'system' };

export interface RecordAuditEventInput {
  readonly organizationId: string;
  readonly actor: AuditActor;
  readonly action: AuditAction;
  readonly resourceType: AuditResourceType;
  readonly resourceId?: string;
  readonly requestId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  /**
   * Structured detail only. Must never contain secrets, plaintext
   * credentials, session/API-key material, or raw card data — this is an
   * application-layer discipline `AuditService` cannot fully enforce, but
   * every call site in this codebase is reviewed against that rule.
   */
  readonly metadata?: Prisma.InputJsonValue;
}
