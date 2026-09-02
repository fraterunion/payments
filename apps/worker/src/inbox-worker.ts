import type { InboxEvent, PrismaClient } from '@fraterunion-payments/database';
import {
  InboxService,
  processStripeInboxEvent,
  type RetryPolicy,
  type StripeInboxAuditWrite,
} from '@fraterunion-payments/events';
import type { Logger } from 'pino';
import type { WorkerEnvironment } from './config/environment.types.js';
import { runPool } from './pool.js';

export interface InboxWorkerTickResult {
  claimed: number;
  processed: number;
  retried: number;
  failed: number;
  reclaimed: number;
}

export interface InboxWorkerDependencies {
  readonly database: PrismaClient;
  readonly inbox: InboxService;
  readonly environment: WorkerEnvironment;
  readonly logger: Logger;
  readonly workerId: string;
  readonly writeAudit: StripeInboxAuditWrite;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly processEvent?: (event: InboxEvent) => Promise<unknown>;
}

const idle = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

/**
 * Polls Stripe InboxEvent rows. Claim commits before the handler.
 * Financial mutation + audit + Inbox PROCESSED commit inside the handler.
 */
export class InboxWorker {
  private stopping = false;
  private running = false;
  private readonly inFlight = new Set<Promise<unknown>>();
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;

  constructor(private readonly deps: InboxWorkerDependencies) {}

  get workerId(): string {
    return this.deps.workerId;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.stopping = false;
    this.running = true;
    this.deps.logger.info('Inbox worker started');
    this.loop = this.runLoop();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    const drained = this.drain();
    const winner = await Promise.race([
      drained.then(() => 'done' as const),
      idle(this.deps.environment.shutdownTimeoutMs).then(() => 'timeout' as const),
    ]);
    this.running = false;
    if (winner === 'timeout') {
      this.deps.logger.warn(
        { inFlight: this.inFlight.size },
        'Inbox shutdown timeout elapsed; unfinished work stays PROCESSING until the claim lease expires',
      );
    } else {
      this.deps.logger.info('Inbox worker stopped');
    }
  }

  async runTick(): Promise<InboxWorkerTickResult> {
    if (this.stopping) {
      return { claimed: 0, processed: 0, retried: 0, failed: 0, reclaimed: 0 };
    }
    const now = this.deps.now?.() ?? new Date();
    const claimed = await this.deps.inbox.claimBatch(this.deps.database, {
      workerId: this.deps.workerId,
      batchSize: this.deps.environment.batchSize,
      claimLeaseMs: this.deps.environment.claimLeaseMs,
      now,
      source: 'stripe',
    });

    const result: InboxWorkerTickResult = {
      claimed: claimed.events.length,
      processed: 0,
      retried: 0,
      failed: 0,
      reclaimed: claimed.reclaimed,
    };

    if (claimed.events.length === 0) {
      return result;
    }

    this.deps.logger.info(
      { claimed: claimed.events.length, reclaimed: claimed.reclaimed },
      'Claimed inbox batch',
    );

    await runPool(claimed.events, this.deps.environment.concurrency, async (event) => {
      if (this.stopping) {
        return;
      }
      const outcome = await this.processClaimed(event);
      result[outcome] += 1;
    });

    return result;
  }

  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.runTick();
      } catch (error) {
        this.deps.logger.error({ err: error }, 'Inbox poll failed');
      }
      if (!this.stopping) {
        await this.waitPollInterval();
      }
    }
  }

  private async waitPollInterval(): Promise<void> {
    if (this.deps.sleep !== undefined) {
      await this.deps.sleep(this.deps.environment.pollIntervalMs);
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wake = undefined;
        resolve();
      }, this.deps.environment.pollIntervalMs);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
    });
  }

  private async drain(): Promise<void> {
    if (this.loop !== undefined) {
      await this.loop;
    }
    await Promise.all(this.inFlight);
  }

  private async processClaimed(event: InboxEvent): Promise<'processed' | 'retried' | 'failed'> {
    const started = Date.now();
    const work = this.dispatchAndSettle(event, started);
    this.inFlight.add(work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(work);
    }
  }

  private async dispatchAndSettle(
    event: InboxEvent,
    started: number,
  ): Promise<'processed' | 'retried' | 'failed'> {
    try {
      if (this.deps.processEvent !== undefined) {
        await this.deps.processEvent(event);
      } else {
        const result = await processStripeInboxEvent(this.deps.database, event, {
          writeAudit: this.deps.writeAudit,
        });
        this.deps.logger.info(
          {
            inboxEventId: event.id,
            sourceEventId: event.externalEventId,
            provider: 'stripe',
            organizationId: result.event.organizationId,
            processingOutcome: result.outcome,
            attempt: event.attemptCount,
            durationMs: Date.now() - started,
          },
          'Inbox event processed',
        );
      }
      return 'processed';
    } catch (error) {
      const retryPolicy: RetryPolicy = {
        maxAttempts: this.deps.environment.maxAttempts,
        baseDelayMs: this.deps.environment.retryBaseMs,
        maxDelayMs: this.deps.environment.retryMaxMs,
      };
      const updated = await this.deps.inbox.markFailedOrRetry(this.deps.database, event, error, {
        retryPolicy,
        claimedBy: this.deps.workerId,
        ...(this.deps.now !== undefined ? { now: this.deps.now() } : {}),
        ...(this.deps.random !== undefined ? { random: this.deps.random } : {}),
      });
      const outcome = updated.status === 'FAILED' ? 'failed' : 'retried';
      this.deps.logger.warn(
        {
          inboxEventId: event.id,
          sourceEventId: event.externalEventId,
          provider: 'stripe',
          organizationId: event.organizationId,
          attempt: updated.attemptCount,
          outcome,
          durationMs: Date.now() - started,
          errorCode: updated.lastErrorCode,
        },
        outcome === 'failed' ? 'Inbox event failed terminally' : 'Inbox event scheduled for retry',
      );
      return outcome;
    }
  }
}
