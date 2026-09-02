import type { AuditLog } from '@fraterunion-payments/database';
import type { RequestContext } from '../auth/types/request-context.type';

/**
 * Action vocabulary currently recorded by authentication flows.
 * Convention: `<domain>.<past-tense-action>`. Do not rename persisted
 * values. Future domains add their own constants; `write` accepts any
 * non-empty action string so this list is not a closed schema.
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

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | (string & {});

export const AUDIT_RESOURCE_TYPES = {
  ORGANIZATION: 'organization',
  USER: 'user',
  SESSION: 'session',
  API_KEY: 'api_key',
} as const;

export type AuditResourceType =
  (typeof AUDIT_RESOURCE_TYPES)[keyof typeof AUDIT_RESOURCE_TYPES] | (string & {});

export type AuditActor =
  | { readonly type: 'USER'; readonly userId: string }
  | { readonly type: 'API_KEY'; readonly apiKeyId: string }
  | { readonly type: 'SYSTEM' };

export interface AuditResource {
  readonly type: string;
  readonly id?: string;
}

export interface WriteAuditInput {
  readonly organizationId: string;
  readonly actor: AuditActor;
  readonly action: string;
  readonly resource: AuditResource;
  readonly requestContext?: RequestContext;
  /**
   * Structured detail only. Must be a JSON object. Forbidden secret keys
   * or values cause the write to be rejected so a surrounding transaction
   * rolls back.
   */
  readonly metadata?: Record<string, unknown>;
}

export const AUDIT_LIST_DEFAULT_LIMIT = 50;
export const AUDIT_LIST_MAX_LIMIT = 100;

export interface AuditListCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface AuditListQuery {
  readonly organizationId: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly actorUserId?: string;
  readonly actorApiKeyId?: string;
  readonly requestId?: string;
  readonly createdAtFrom?: Date;
  readonly createdAtTo?: Date;
  readonly limit?: number;
  readonly cursor?: AuditListCursor;
}

export interface AuditListResult {
  readonly items: readonly AuditLog[];
  readonly nextCursor: AuditListCursor | undefined;
}

export const AUDIT_METADATA_MAX_BYTES = 16_384;
export const AUDIT_METADATA_MAX_DEPTH = 8;
export const AUDIT_USER_AGENT_MAX_LENGTH = 512;
