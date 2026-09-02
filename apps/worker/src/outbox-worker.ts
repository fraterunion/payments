import type { OutboxEvent, PrismaClient } from '@fraterunion-payments/database';
import {
  EventHandlerRegistry,
  OutboxService,
  type RetryPolicy,
} from '@fraterunion-payments/events';
import type { Logger } from 'pino';
import type { WorkerEnvironment } from './config/environment.types.js';
import { runPool } from './pool.js';

export interface WorkerTickResult {
  claimed: number;
  processed: number;
  retried: number;
  failed: number;
  reclaimed: number;
}

export interface OutboxWorkerDependencies {
  readonly database: PrismaClient;
  readonly outbox: OutboxService;
  readonly registry: EventHandlerRegistry;
  readonly environment: WorkerEnvironment;
  readonly logger: Logger;
  readonly workerId: string;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly claimEventTypePrefix?: string;
}

const idle = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

/**
 * Polls the transactional outbox. Claim commits before any handler runs.
 * Abandoned PROCESSING rows become eligible again when their lease expires.
 */
export class OutboxWorker {
  private stopping = false;
  private running = false;
  private readonly inFlight = new Set<Promise<unknown>>();
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;

  constructor(private readonly deps: OutboxWorkerDependencies) {}

  get workerId(): string {
    return this.deps.workerId;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.stopping = false;
    this.running = true;
    this.deps.logger.info('Outbox worker started');
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
        'Shutdown timeout elapsed; unfinished work stays PROCESSING until the claim lease expires',
      );
    } else {
      this.deps.logger.info('Outbox worker stopped');
    }
  }

  async runTick(): Promise<WorkerTickResult> {
    if (this.stopping) {
      return { claimed: 0, processed: 0, retried: 0, failed: 0, reclaimed: 0 };
    }
    const now = this.deps.now?.() ?? new Date();
    const claimed = await this.deps.outbox.claimBatch(this.deps.database, {
      workerId: this.deps.workerId,
      batchSize: this.deps.environment.batchSize,
      claimLeaseMs: this.deps.environment.claimLeaseMs,
      now,
      ...(this.deps.claimEventTypePrefix !== undefined
        ? { eventTypePrefix: this.deps.claimEventTypePrefix }
        : {}),
    });

    const result: WorkerTickResult = {
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
      'Claimed outbox batch',
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
        this.deps.logger.error({ err: error }, 'Outbox poll failed');
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

  private async processClaimed(event: OutboxEvent): Promise<'processed' | 'retried' | 'failed'> {
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
    event: OutboxEvent,
    started: number,
  ): Promise<'processed' | 'retried' | 'failed'> {
    try {
      await this.deps.registry.dispatch(event);
      await this.deps.outbox.markProcessed(this.deps.database, event.id);
      this.deps.logger.info(
        {
          eventId: event.id,
          eventType: event.eventType,
          organizationId: event.organizationId,
          attempt: event.attemptCount,
          outcome: 'processed',
          durationMs: Date.now() - started,
        },
        'Outbox event processed',
      );
      return 'processed';
    } catch (error) {
      const retryPolicy: RetryPolicy = {
        maxAttempts: this.deps.environment.maxAttempts,
        baseDelayMs: this.deps.environment.retryBaseMs,
        maxDelayMs: this.deps.environment.retryMaxMs,
      };
      const updated = await this.deps.outbox.markFailedOrRetry(this.deps.database, event, error, {
        retryPolicy,
        ...(this.deps.now !== undefined ? { now: this.deps.now() } : {}),
        ...(this.deps.random !== undefined ? { random: this.deps.random } : {}),
      });
      const outcome = updated.status === 'FAILED' ? 'failed' : 'retried';
      this.deps.logger.warn(
        {
          eventId: event.id,
          eventType: event.eventType,
          organizationId: event.organizationId,
          attempt: updated.attemptCount,
          outcome,
          durationMs: Date.now() - started,
          errorCode: updated.lastErrorCode,
        },
        outcome === 'failed'
          ? 'Outbox event failed terminally'
          : 'Outbox event scheduled for retry',
      );
      return outcome;
    }
  }
}
