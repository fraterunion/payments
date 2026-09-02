import type { OutboxEvent, PrismaClient } from '@fraterunion-payments/database';
import { errorCodeOf, isRetryableFailure } from '../errors.js';
import { computeRetryDelayMs } from '../retry/backoff.js';
import { sanitizeErrorMessage } from '../sanitize/error-sanitize.js';
import type { EventWriteClient } from '../types.js';
import type {
  ClaimBatchOptions,
  EnqueueOutboxInput,
  MarkFailedOrRetryOptions,
} from './outbox.types.js';

/**
 * Transactional outbox. `enqueue` must be called with the same Prisma
 * transaction client as the business mutation. Claiming is a short
 * `FOR UPDATE SKIP LOCKED` transaction and must not stay open while a
 * handler runs.
 */
export class OutboxService {
  async enqueue(client: EventWriteClient, input: EnqueueOutboxInput): Promise<OutboxEvent> {
    if (input.eventType.trim().length === 0) {
      throw new TypeError('eventType must be non-empty.');
    }

    return client.outboxEvent.create({
      data: {
        eventType: input.eventType,
        payload: input.payload === undefined ? {} : input.payload,
        ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
        ...(input.aggregateType !== undefined ? { aggregateType: input.aggregateType } : {}),
        ...(input.aggregateId !== undefined ? { aggregateId: input.aggregateId } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
        ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
        ...(input.availableAt !== undefined ? { availableAt: input.availableAt } : {}),
      },
    });
  }

  /**
   * Claims a bounded batch of eligible events. Eligible means PENDING and
   * available, or PROCESSING with an expired lease. The claim transaction
   * commits before this method returns.
   */
  async claimBatch(
    client: PrismaClient,
    options: ClaimBatchOptions,
  ): Promise<{ events: OutboxEvent[]; reclaimed: number }> {
    if (options.batchSize < 1) {
      throw new RangeError('batchSize must be >= 1');
    }
    if (options.claimLeaseMs < 1) {
      throw new RangeError('claimLeaseMs must be >= 1');
    }

    const now = options.now ?? new Date();
    const claimExpiresAt = new Date(now.getTime() + options.claimLeaseMs);
    const eventTypePattern =
      options.eventTypePrefix === undefined ? '%' : `${options.eventTypePrefix}%`;

    return client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status
        FROM outbox_events
        WHERE (
          (status = 'PENDING'::outbox_event_status AND available_at <= ${now})
          OR (
            status = 'PROCESSING'::outbox_event_status
            AND claim_expires_at IS NOT NULL
            AND claim_expires_at <= ${now}
          )
        )
        AND event_type LIKE ${eventTypePattern}
        ORDER BY available_at ASC, created_at ASC
        LIMIT ${options.batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (locked.length === 0) {
        return { events: [], reclaimed: 0 };
      }

      const ids = locked.map((row) => row.id);
      const reclaimed = locked.filter((row) => row.status === 'PROCESSING').length;
      await tx.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'PROCESSING',
          claimedAt: now,
          claimExpiresAt,
          claimedBy: options.workerId,
        },
      });

      const events = await tx.outboxEvent.findMany({
        where: { id: { in: ids } },
        orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
      });
      return { events, reclaimed };
    });
  }

  async markProcessed(
    client: EventWriteClient,
    eventId: string,
    now = new Date(),
  ): Promise<OutboxEvent> {
    return client.outboxEvent.update({
      where: { id: eventId },
      data: {
        status: 'PROCESSED',
        processedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }

  async markFailedOrRetry(
    client: EventWriteClient,
    event: Pick<OutboxEvent, 'id' | 'attemptCount'>,
    error: unknown,
    options: MarkFailedOrRetryOptions,
  ): Promise<OutboxEvent> {
    const now = options.now ?? new Date();
    const nextAttempt = event.attemptCount + 1;
    const retryable = isRetryableFailure(error);
    const exhausted = nextAttempt >= options.retryPolicy.maxAttempts;
    const terminal = !retryable || exhausted;

    const lastErrorCode = errorCodeOf(error);
    const lastErrorMessage = sanitizeErrorMessage(error);

    if (terminal) {
      return client.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          attemptCount: nextAttempt,
          lastErrorCode,
          lastErrorMessage,
          claimedAt: null,
          claimExpiresAt: null,
          claimedBy: null,
        },
      });
    }

    const delayMs = computeRetryDelayMs(nextAttempt - 1, options.retryPolicy, options.random);
    return client.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: 'PENDING',
        attemptCount: nextAttempt,
        availableAt: new Date(now.getTime() + delayMs),
        lastErrorCode,
        lastErrorMessage,
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
      },
    });
  }

  /**
   * Expired PROCESSING leases are also picked up by {@link claimBatch}.
   * This method exists as an explicit operational hook and returns how
   * many expired rows were eligible at `now`.
   */
  async reclaimExpired(
    client: PrismaClient,
    options: {
      readonly workerId: string;
      readonly batchSize: number;
      readonly claimLeaseMs: number;
      readonly now?: Date;
    },
  ): Promise<{ events: OutboxEvent[]; reclaimed: number }> {
    return this.claimBatch(client, options);
  }
}
