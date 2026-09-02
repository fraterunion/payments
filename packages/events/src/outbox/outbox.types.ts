import type { OutboxEvent, Prisma } from '@fraterunion-payments/database';
import type { RetryPolicy } from '../types.js';

export interface EnqueueOutboxInput {
  readonly organizationId?: string;
  readonly eventType: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly payload: Prisma.InputJsonValue;
  readonly metadata?: Prisma.InputJsonValue;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly availableAt?: Date;
}

export interface ClaimBatchOptions {
  readonly workerId: string;
  readonly batchSize: number;
  readonly claimLeaseMs: number;
  readonly now?: Date;
  /** Optional `event_type LIKE prefix%` scope. Production omits this. */
  readonly eventTypePrefix?: string;
}

export interface MarkFailedOrRetryOptions {
  readonly retryPolicy: RetryPolicy;
  readonly now?: Date;
  readonly random?: () => number;
}

export type ClaimedOutboxEvent = OutboxEvent;
