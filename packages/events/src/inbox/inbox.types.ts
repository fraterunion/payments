import type { InboxEvent, Prisma } from '@fraterunion-payments/database';
import type { InboxReceiveKind, RetryPolicy } from '../types.js';

export interface ReceiveInboxInput {
  readonly organizationId?: string;
  readonly source: string;
  readonly externalEventId: string;
  readonly eventType: string;
  readonly payload: Prisma.InputJsonValue;
}

export interface InboxReceiveResult {
  readonly kind: InboxReceiveKind;
  readonly event: InboxEvent;
}

export interface InboxRetryOptions {
  readonly retryPolicy: RetryPolicy;
  readonly now?: Date;
  readonly random?: () => number;
  /** When set, only a PROCESSING row claimed by this worker is settled. */
  readonly claimedBy?: string;
}

export type InboxOrganizationAssignKind = 'ASSIGNED' | 'UNCHANGED' | 'TENANT_CONFLICT';

export interface InboxOrganizationAssignResult {
  readonly kind: InboxOrganizationAssignKind;
  readonly event: InboxEvent;
}

export interface InboxClaimBatchOptions {
  readonly workerId: string;
  readonly batchSize: number;
  readonly claimLeaseMs: number;
  readonly now?: Date;
  readonly source?: string;
}

export const INBOX_PROCESSING_OUTCOMES = {
  APPLIED: 'APPLIED',
  NOOP_ALREADY_CURRENT: 'NOOP_ALREADY_CURRENT',
  NOOP_STALE: 'NOOP_STALE',
  IGNORED_EVENT_TYPE: 'IGNORED_EVENT_TYPE',
  UNRESOLVED_REFERENCE: 'UNRESOLVED_REFERENCE',
  ANOMALY: 'ANOMALY',
} as const;

export type InboxProcessingOutcome =
  (typeof INBOX_PROCESSING_OUTCOMES)[keyof typeof INBOX_PROCESSING_OUTCOMES];
