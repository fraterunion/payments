import type { InboxEvent, PrismaClient } from '@fraterunion-payments/database';
import { Prisma } from '@fraterunion-payments/database';
import { errorCodeOf, isRetryableFailure, TerminalEventError } from '../errors.js';
import { hashPayload } from '../hash/payload-hash.js';
import { computeRetryDelayMs } from '../retry/backoff.js';
import { sanitizeErrorMessage } from '../sanitize/error-sanitize.js';
import {
  DEFAULT_CLAIM_LEASE_MS,
  isGloballyUniqueInboxSource,
  PLATFORM_SCOPE_KEY,
  type EventWriteClient,
} from '../types.js';
import type {
  InboxClaimBatchOptions,
  InboxOrganizationAssignResult,
  InboxProcessingOutcome,
  InboxReceiveResult,
  InboxRetryOptions,
  ReceiveInboxInput,
} from './inbox.types.js';

export function inboxScopeKey(organizationId: string | undefined): string {
  return organizationId === undefined ? PLATFORM_SCOPE_KEY : organizationId;
}

/**
 * Durable inbox. Generic identity is `(scopeKey, source, externalEventId)`
 * where `scopeKey` is the organization UUID or `platform`. Stripe Event
 * IDs are additionally unique on `(source, externalEventId)` regardless
 * of scope — tenant association is routing, not identity. Concurrent
 * first receipts serialize on those unique constraints. `payload` is the
 * verified inbound JSON object and is never overwritten.
 */
export class InboxService {
  async receive(client: EventWriteClient, input: ReceiveInboxInput): Promise<InboxReceiveResult> {
    if (input.source.trim().length === 0) {
      throw new TypeError('source must be non-empty.');
    }
    if (input.externalEventId.trim().length === 0) {
      throw new TypeError('externalEventId must be non-empty.');
    }

    const scopeKey = inboxScopeKey(input.organizationId);
    const payloadHash = hashPayload(input.payload);

    try {
      const event = await client.inboxEvent.create({
        data: {
          scopeKey,
          source: input.source,
          externalEventId: input.externalEventId,
          eventType: input.eventType,
          payload: input.payload,
          payloadHash,
          status: 'RECEIVED',
          ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
        },
      });
      return { kind: 'NEW', event };
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }

    const existing = await findExistingInboxEvent(client, {
      scopeKey,
      source: input.source,
      externalEventId: input.externalEventId,
    });

    if (existing === null) {
      throw new Error('Inbox unique conflict could not be reloaded.');
    }

    if (existing.payloadHash !== payloadHash) {
      return { kind: 'CONFLICT', event: existing };
    }

    return { kind: 'DUPLICATE', event: existing };
  }

  /**
   * Promote an unresolved (platform-scoped) inbox row to a known tenant.
   * Does not overwrite payload. Never clears a known organization and
   * never moves a row from one tenant to another.
   */
  async assignOrganizationIfUnresolved(
    client: EventWriteClient,
    eventId: string,
    organizationId: string,
  ): Promise<InboxOrganizationAssignResult> {
    if (organizationId.trim().length === 0) {
      throw new TypeError('organizationId must be non-empty.');
    }

    const promoted = await client.inboxEvent.updateMany({
      where: {
        id: eventId,
        organizationId: null,
        scopeKey: PLATFORM_SCOPE_KEY,
      },
      data: {
        organizationId,
        scopeKey: organizationId,
      },
    });

    const event = await client.inboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (promoted.count === 1) {
      return { kind: 'ASSIGNED', event };
    }
    if (event.organizationId === organizationId) {
      return { kind: 'UNCHANGED', event };
    }
    if (event.organizationId === null) {
      return { kind: 'UNCHANGED', event };
    }
    return { kind: 'TENANT_CONFLICT', event };
  }

  async beginProcessing(
    client: EventWriteClient,
    eventId: string,
    now = new Date(),
    claimedBy = 'begin-processing',
    claimLeaseMs = DEFAULT_CLAIM_LEASE_MS,
  ): Promise<InboxEvent> {
    const updated = await client.inboxEvent.updateMany({
      where: { id: eventId, status: 'RECEIVED' },
      data: {
        status: 'PROCESSING',
        processingStartedAt: now,
        claimedAt: now,
        claimExpiresAt: new Date(now.getTime() + claimLeaseMs),
        claimedBy,
      },
    });
    if (updated.count === 1) {
      return client.inboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    }

    const existing = await client.inboxEvent.findUnique({ where: { id: eventId } });
    if (existing?.status === 'PROCESSED') {
      throw new TerminalEventError('Inbox event already processed.', 'ALREADY_PROCESSED');
    }
    throw new TerminalEventError(
      `Inbox event ${eventId} is not eligible to begin processing.`,
      'INBOX_NOT_RECEIVED',
    );
  }

  /**
   * Short claim transaction: RECEIVED and available, or PROCESSING with an
   * expired lease. Commits before the handler runs.
   */
  async claimBatch(
    client: PrismaClient,
    options: InboxClaimBatchOptions,
  ): Promise<{ events: InboxEvent[]; reclaimed: number }> {
    if (options.batchSize < 1) {
      throw new RangeError('batchSize must be >= 1');
    }
    if (options.claimLeaseMs < 1) {
      throw new RangeError('claimLeaseMs must be >= 1');
    }

    const now = options.now ?? new Date();
    const claimExpiresAt = new Date(now.getTime() + options.claimLeaseMs);
    const source = options.source;

    return client.$transaction(async (tx) => {
      const locked =
        source === undefined
          ? await tx.$queryRaw<Array<{ id: string; status: string }>>`
              SELECT id, status
              FROM inbox_events
              WHERE (
                (status = 'RECEIVED'::inbox_event_status AND available_at <= ${now})
                OR (
                  status = 'PROCESSING'::inbox_event_status
                  AND claim_expires_at IS NOT NULL
                  AND claim_expires_at <= ${now}
                )
              )
              ORDER BY available_at ASC, received_at ASC
              LIMIT ${options.batchSize}
              FOR UPDATE SKIP LOCKED
            `
          : await tx.$queryRaw<Array<{ id: string; status: string }>>`
              SELECT id, status
              FROM inbox_events
              WHERE source = ${source}
              AND (
                (status = 'RECEIVED'::inbox_event_status AND available_at <= ${now})
                OR (
                  status = 'PROCESSING'::inbox_event_status
                  AND claim_expires_at IS NOT NULL
                  AND claim_expires_at <= ${now}
                )
              )
              ORDER BY available_at ASC, received_at ASC
              LIMIT ${options.batchSize}
              FOR UPDATE SKIP LOCKED
            `;

      if (locked.length === 0) {
        return { events: [], reclaimed: 0 };
      }

      const ids = locked.map((row) => row.id);
      const reclaimed = locked.filter((row) => row.status === 'PROCESSING').length;
      await tx.inboxEvent.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'PROCESSING',
          processingStartedAt: now,
          claimedAt: now,
          claimExpiresAt,
          claimedBy: options.workerId,
        },
      });

      const events = await tx.inboxEvent.findMany({
        where: { id: { in: ids } },
        orderBy: [{ availableAt: 'asc' }, { receivedAt: 'asc' }],
      });
      return { events, reclaimed };
    });
  }

  async markProcessed(
    client: EventWriteClient,
    eventId: string,
    now = new Date(),
    processingOutcome?: InboxProcessingOutcome,
  ): Promise<InboxEvent> {
    return client.inboxEvent.update({
      where: { id: eventId },
      data: {
        status: 'PROCESSED',
        processedAt: now,
        processingOutcome: processingOutcome ?? null,
        lastErrorCode: null,
        lastErrorMessage: null,
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
      },
    });
  }

  async markFailedOrRetry(
    client: EventWriteClient,
    event: Pick<InboxEvent, 'id' | 'attemptCount'>,
    error: unknown,
    options: InboxRetryOptions,
  ): Promise<InboxEvent> {
    const now = options.now ?? new Date();
    const nextAttempt = event.attemptCount + 1;
    const retryable = isRetryableFailure(error);
    const exhausted = nextAttempt >= options.retryPolicy.maxAttempts;
    const terminal = !retryable || exhausted;
    const lastErrorCode = errorCodeOf(error);
    const lastErrorMessage = sanitizeErrorMessage(error);

    const where = {
      id: event.id,
      status: 'PROCESSING' as const,
      ...(options.claimedBy !== undefined ? { claimedBy: options.claimedBy } : {}),
    };

    if (terminal) {
      const updated = await client.inboxEvent.updateMany({
        where,
        data: {
          status: 'FAILED',
          attemptCount: nextAttempt,
          lastErrorCode,
          lastErrorMessage,
          processingOutcome: 'ANOMALY',
          claimedAt: null,
          claimExpiresAt: null,
          claimedBy: null,
        },
      });
      if (updated.count === 0) {
        return client.inboxEvent.findUniqueOrThrow({ where: { id: event.id } });
      }
      return client.inboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    }

    const delayMs = computeRetryDelayMs(nextAttempt - 1, options.retryPolicy, options.random);
    const retried = await client.inboxEvent.updateMany({
      where,
      data: {
        status: 'RECEIVED',
        attemptCount: nextAttempt,
        availableAt: new Date(now.getTime() + delayMs),
        lastErrorCode,
        lastErrorMessage,
        processingStartedAt: null,
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
        processingOutcome:
          lastErrorCode === 'UNRESOLVED_EXTERNAL_REFERENCE' ? 'UNRESOLVED_REFERENCE' : null,
      },
    });
    if (retried.count === 0) {
      return client.inboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    }
    return client.inboxEvent.findUniqueOrThrow({ where: { id: event.id } });
  }
}

async function findExistingInboxEvent(
  client: EventWriteClient,
  input: {
    readonly scopeKey: string;
    readonly source: string;
    readonly externalEventId: string;
  },
): Promise<InboxEvent | null> {
  if (isGloballyUniqueInboxSource(input.source)) {
    return client.inboxEvent.findFirst({
      where: { source: input.source, externalEventId: input.externalEventId },
    });
  }

  return client.inboxEvent.findUnique({
    where: {
      scopeKey_source_externalEventId: {
        scopeKey: input.scopeKey,
        source: input.source,
        externalEventId: input.externalEventId,
      },
    },
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
