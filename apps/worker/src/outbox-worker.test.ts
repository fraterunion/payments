import { describe, expect, it, vi } from 'vitest';
import type { OutboxEvent, PrismaClient } from '@fraterunion-payments/database';
import {
  EventHandlerRegistry,
  OutboxService,
  RetryableEventError,
  TerminalEventError,
} from '@fraterunion-payments/events';
import type { WorkerEnvironment } from './config/environment.types.js';
import { OutboxWorker } from './outbox-worker.js';

function environment(overrides: Partial<WorkerEnvironment> = {}): WorkerEnvironment {
  return {
    nodeEnv: 'test',
    databaseUrl: 'postgresql://user:password@localhost:5432/test',
    logLevel: 'info',
    pollIntervalMs: 50,
    batchSize: 10,
    claimLeaseMs: 60_000,
    maxAttempts: 10,
    retryBaseMs: 1_000,
    retryMaxMs: 900_000,
    concurrency: 2,
    shutdownTimeoutMs: 200,
    ...overrides,
  };
}

function fakeEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: 'event-1',
    organizationId: null,
    eventType: 'events.test',
    aggregateType: null,
    aggregateId: null,
    payload: {},
    metadata: {},
    correlationId: null,
    causationId: null,
    status: 'PROCESSING',
    attemptCount: 0,
    availableAt: new Date(),
    claimedAt: new Date(),
    claimExpiresAt: new Date(Date.now() + 60_000),
    claimedBy: 'worker-1',
    processedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as OutboxEvent;
}

function createWorker(options: {
  claim?: { events: OutboxEvent[]; reclaimed: number };
  registry?: EventHandlerRegistry;
  environment?: WorkerEnvironment;
  markProcessed?: ReturnType<typeof vi.fn>;
  markFailedOrRetry?: ReturnType<typeof vi.fn>;
}) {
  const claimBatch = vi.fn().mockResolvedValue(options.claim ?? { events: [], reclaimed: 0 });
  const markProcessed = options.markProcessed ?? vi.fn().mockResolvedValue({});
  const markFailedOrRetry =
    options.markFailedOrRetry ??
    vi.fn().mockImplementation(async (_db, event: OutboxEvent, error: unknown) => ({
      ...event,
      status: error instanceof TerminalEventError ? 'FAILED' : 'PENDING',
      attemptCount: event.attemptCount + 1,
      lastErrorCode: 'TEST',
    }));

  const outbox = {
    claimBatch,
    markProcessed,
    markFailedOrRetry,
  } as unknown as OutboxService;

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const worker = new OutboxWorker({
    database: {} as PrismaClient,
    outbox,
    registry: options.registry ?? new EventHandlerRegistry(),
    environment: options.environment ?? environment(),
    logger: logger as never,
    workerId: 'worker-1',
    sleep: async () => undefined,
  });

  return { worker, claimBatch, markProcessed, markFailedOrRetry, logger };
}

describe('OutboxWorker', () => {
  it('does not dispatch a handler until after claimBatch resolves', async () => {
    const order: string[] = [];
    const registry = new EventHandlerRegistry();
    registry.register('events.test', async () => {
      order.push('handler');
    });

    const { worker, claimBatch, markProcessed } = createWorker({
      registry,
      claim: { events: [fakeEvent()], reclaimed: 0 },
    });
    claimBatch.mockImplementation(async () => {
      order.push('claim');
      return { events: [fakeEvent()], reclaimed: 0 };
    });

    await worker.runTick();

    expect(order).toEqual(['claim', 'handler']);
    expect(markProcessed).toHaveBeenCalledWith({}, 'event-1');
  });

  it('records processed, retryable, terminal, and unknown-handler outcomes', async () => {
    const retryable = fakeEvent({ id: 'r', eventType: 'events.retry' });
    const terminal = fakeEvent({ id: 't', eventType: 'events.terminal' });
    const unknown = fakeEvent({ id: 'u', eventType: 'events.unknown' });
    const ok = fakeEvent({ id: 'ok', eventType: 'events.test' });

    const registry = new EventHandlerRegistry();
    registry.register('events.test', async () => undefined);
    registry.register('events.retry', async () => {
      throw new RetryableEventError('later');
    });
    registry.register('events.terminal', async () => {
      throw new TerminalEventError('nope');
    });

    const { worker, markFailedOrRetry } = createWorker({
      registry,
      claim: { events: [ok, retryable, terminal, unknown], reclaimed: 0 },
    });

    const result = await worker.runTick();
    expect(result).toMatchObject({ claimed: 4, processed: 1, retried: 1, failed: 2 });
    expect(markFailedOrRetry).toHaveBeenCalledTimes(3);
  });

  it('respects the concurrency limit', async () => {
    let current = 0;
    let peak = 0;
    const events = [fakeEvent({ id: 'a' }), fakeEvent({ id: 'b' }), fakeEvent({ id: 'c' })];
    const registry = new EventHandlerRegistry();
    registry.register('events.test', async () => {
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      current -= 1;
    });

    const { worker } = createWorker({
      registry,
      environment: environment({ concurrency: 2 }),
      claim: { events, reclaimed: 0 },
    });

    await worker.runTick();
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('stops claiming new work on shutdown and does not mark unfinished work processed', async () => {
    const release = vi.fn();
    const registry = new EventHandlerRegistry();
    registry.register('events.test', async () => {
      await new Promise<void>((resolve) => {
        release.mockImplementation(() => {
          resolve();
        });
      });
    });

    const { worker, markProcessed, claimBatch } = createWorker({
      registry,
      environment: environment({ shutdownTimeoutMs: 30, pollIntervalMs: 10 }),
      claim: { events: [fakeEvent()], reclaimed: 0 },
    });

    await worker.start();
    await new Promise((resolve) => {
      setTimeout(resolve, 15);
    });
    const stop = worker.stop();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(markProcessed).not.toHaveBeenCalled();
    release();
    await stop;
    expect(claimBatch.mock.calls.length).toBeGreaterThan(0);
  });

  it('returns from stop when active work exceeds the shutdown timeout', async () => {
    const registry = new EventHandlerRegistry();
    registry.register('events.test', async () => {
      await new Promise<void>(() => undefined);
    });

    const { worker, markProcessed } = createWorker({
      registry,
      environment: environment({ shutdownTimeoutMs: 40, pollIntervalMs: 10 }),
      claim: { events: [fakeEvent()], reclaimed: 0 },
    });

    await worker.start();
    await new Promise((resolve) => {
      setTimeout(resolve, 15);
    });
    const started = Date.now();
    await worker.stop();
    expect(Date.now() - started).toBeLessThan(250);
    expect(markProcessed).not.toHaveBeenCalled();
  });
});
