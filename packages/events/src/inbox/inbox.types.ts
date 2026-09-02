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
}
