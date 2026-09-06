import type { InboxEvent, PrismaClient } from '@fraterunion-payments/database';
import {
  InboxService,
  type InboxEventHandler,
  type InboxHandlerRegistry,
  type RetryPolicy,
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
  readonly handlers: InboxHandlerRegistry;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const idle = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

function registeredSources(handlers: InboxHandlerRegistry): string[] {
  return Object.keys(handlers).filter((source) => source.trim().length > 0);
}

function handlerFor(handlers: InboxHandlerRegistry, source: string): InboxEventHandler | undefined {
  return handlers[source];
}

/**
 * Polls InboxEvent rows for registered sources only. Claim commits before
 * the handler. Provider selection is injected; this worker never imports a
 * payment provider.
 */
export class InboxWorker {
  private stopping = false;
  private running = false;
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly sources: readonly string[];
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;

  constructor(private readonly deps: InboxWorkerDependencies) {
    const sources = registeredSources(deps.handlers);
    if (sources.length !== Object.keys(deps.handlers).length) {
      throw new TypeError('Inbox handler source must be non-empty.');
    }
    this.sources = sources;
  }

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
    const claimedEvents: InboxEvent[] = [];
    let reclaimed = 0;

    for (const source of this.sources) {
      const claimed = await this.deps.inbox.claimBatch(this.deps.database, {
        workerId: this.deps.workerId,
        batchSize: this.deps.environment.batchSize,
        claimLeaseMs: this.deps.environment.claimLeaseMs,
        now,
        source,
      });
      claimedEvents.push(...claimed.events);
      reclaimed += claimed.reclaimed;
    }

    const result: InboxWorkerTickResult = {
      claimed: claimedEvents.length,
      processed: 0,
      retried: 0,
      failed: 0,
      reclaimed,
    };

    if (claimedEvents.length === 0) {
      return result;
    }

    this.deps.logger.info({ claimed: claimedEvents.length, reclaimed }, 'Claimed inbox batch');

    await runPool(claimedEvents, this.deps.environment.concurrency, async (event) => {
      if (this.stopping) {
        return;
      }
      const outcome = await this.processClaimed(event);
      if (outcome !== undefined) {
        result[outcome] += 1;
      }
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

  private async processClaimed(
    event: InboxEvent,
  ): Promise<'processed' | 'retried' | 'failed' | undefined> {
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
  ): Promise<'processed' | 'retried' | 'failed' | undefined> {
    const handler = handlerFor(this.deps.handlers, event.source);
    if (handler === undefined) {
      this.deps.logger.warn(
        {
          inboxEventId: event.id,
          sourceEventId: event.externalEventId,
          source: event.source,
        },
        'No inbox handler registered; leaving claimed event for lease expiry',
      );
      return undefined;
    }

    try {
      const result = await handler(event);
      this.deps.logger.info(
        {
          inboxEventId: event.id,
          sourceEventId: event.externalEventId,
          source: event.source,
          organizationId: inboxOrganizationId(result),
          processingOutcome: inboxOutcome(result),
          attempt: event.attemptCount,
          durationMs: Date.now() - started,
        },
        'Inbox event processed',
      );
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
          source: event.source,
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

function inboxOutcome(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null || !('outcome' in result)) {
    return undefined;
  }
  const outcome = result.outcome;
  return typeof outcome === 'string' ? outcome : undefined;
}

function inboxOrganizationId(result: unknown): string | null | undefined {
  if (typeof result !== 'object' || result === null || !('event' in result)) {
    return undefined;
  }
  const event = result.event;
  if (typeof event !== 'object' || event === null || !('organizationId' in event)) {
    return undefined;
  }
  const organizationId = event.organizationId;
  return typeof organizationId === 'string' || organizationId === null ? organizationId : undefined;
}
