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
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_ARCHIVED: 'customer.archived',
  CUSTOMER_PROVIDER_MAPPING_CREATED: 'customer.provider_mapping_created',
  PAYMENT_CREATED: 'payment.created',
  PAYMENT_REQUIRES_PAYMENT_METHOD: 'payment.requires_payment_method',
  PAYMENT_AUTHORIZATION_STARTED: 'payment.authorization_started',
  PAYMENT_REQUIRES_ACTION: 'payment.requires_action',
  PAYMENT_AUTHORIZATION_RESUMED: 'payment.authorization_resumed',
  PAYMENT_AUTHORIZED: 'payment.authorized',
  PAYMENT_CAPTURE_STARTED: 'payment.capture_started',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_CANCELED: 'payment.canceled',
  PAYMENT_PARTIALLY_REFUNDED: 'payment.partially_refunded',
  PAYMENT_REFUNDED: 'payment.refunded',
  REFUND_CREATED: 'refund.created',
  REFUND_PROCESSING_STARTED: 'refund.processing_started',
  REFUND_SUCCEEDED: 'refund.succeeded',
  REFUND_FAILED: 'refund.failed',
  PAYMENT_PROVIDER_EXECUTION_CREATED: 'payment.provider_execution_created',
  REFUND_PROVIDER_EXECUTION_CREATED: 'refund.provider_execution_created',
  PROVIDER_CONNECTION_CREATED: 'provider_connection.created',
  PROVIDER_CONNECTION_ONBOARDING_LINK_CREATED: 'provider_connection.onboarding_link_created',
  PROVIDER_CONNECTION_REFRESHED: 'provider_connection.refreshed',
  PROVIDER_CONNECTION_STATUS_CHANGED: 'provider_connection.status_changed',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | (string & {});

export const AUDIT_RESOURCE_TYPES = {
  ORGANIZATION: 'organization',
  USER: 'user',
  SESSION: 'session',
  API_KEY: 'api_key',
  CUSTOMER: 'customer',
  CUSTOMER_PROVIDER_MAPPING: 'customer_provider_mapping',
  PAYMENT: 'payment',
  REFUND: 'refund',
  PAYMENT_PROVIDER_EXECUTION: 'payment_provider_execution',
  REFUND_PROVIDER_EXECUTION: 'refund_provider_execution',
  PROVIDER_ACCOUNT_CONNECTION: 'provider_account_connection',
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
