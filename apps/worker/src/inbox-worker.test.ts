import { describe, expect, it, vi } from 'vitest';
import type { InboxEvent, PrismaClient } from '@fraterunion-payments/database';
import { InboxService, TerminalEventError } from '@fraterunion-payments/events';
import type { WorkerEnvironment } from './config/environment.types.js';
import { InboxWorker } from './inbox-worker.js';

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

function fakeEvent(overrides: Partial<InboxEvent> = {}): InboxEvent {
  return {
    id: 'inbox-1',
    organizationId: null,
    scopeKey: 'platform',
    source: 'stripe',
    externalEventId: 'evt_1',
    eventType: 'payment_intent.succeeded',
    payload: {},
    payloadHash: 'abc',
    status: 'PROCESSING',
    attemptCount: 0,
    receivedAt: new Date(),
    availableAt: new Date(),
    processingStartedAt: new Date(),
    processedAt: null,
    claimedAt: new Date(),
    claimExpiresAt: new Date(Date.now() + 60_000),
    claimedBy: 'worker-1',
    processingOutcome: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as InboxEvent;
}

function createWorker(options: {
  claim?: { events: InboxEvent[]; reclaimed: number };
  processEvent?: (event: InboxEvent) => Promise<unknown>;
  handlers?: Record<string, (event: InboxEvent) => Promise<unknown>>;
  markFailedOrRetry?: ReturnType<typeof vi.fn>;
}) {
  const claimBatch = vi.fn().mockResolvedValue(options.claim ?? { events: [], reclaimed: 0 });
  const markFailedOrRetry =
    options.markFailedOrRetry ??
    vi.fn().mockImplementation(async (_db, event: InboxEvent, error: unknown) => ({
      ...event,
      status: error instanceof TerminalEventError ? 'FAILED' : 'RECEIVED',
      attemptCount: event.attemptCount + 1,
      lastErrorCode: 'TEST',
    }));

  const inbox = {
    claimBatch,
    markFailedOrRetry,
  } as unknown as InboxService;

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const worker = new InboxWorker({
    database: {} as PrismaClient,
    inbox,
    environment: environment(),
    logger: logger as never,
    workerId: 'worker-1',
    sleep: async () => undefined,
    handlers: options.handlers ?? {
      stripe: options.processEvent ?? (async () => undefined),
    },
  });

  return { worker, claimBatch, markFailedOrRetry, logger };
}

describe('InboxWorker', () => {
  it('does not run the processor until after claimBatch resolves', async () => {
    const order: string[] = [];
    const { worker, claimBatch } = createWorker({
      processEvent: async () => {
        order.push('handler');
      },
    });
    claimBatch.mockImplementation(async () => {
      order.push('claim');
      return { events: [fakeEvent()], reclaimed: 0 };
    });

    await worker.runTick();
    expect(order).toEqual(['claim', 'handler']);
  });

  it('claims only registered sources and invokes the Stripe handler', async () => {
    const invoked: string[] = [];
    const stripeHandler = vi.fn(async (event: InboxEvent) => {
      invoked.push(event.source);
      return { outcome: 'APPLIED', event };
    });
    const { worker, claimBatch } = createWorker({
      handlers: { stripe: stripeHandler },
    });
    claimBatch.mockImplementation(async (_db, options: { source?: string }) => {
      if (options.source === 'stripe') {
        return { events: [fakeEvent()], reclaimed: 0 };
      }
      return { events: [], reclaimed: 0 };
    });

    const result = await worker.runTick();
    expect(claimBatch).toHaveBeenCalledTimes(1);
    expect(claimBatch.mock.calls[0]?.[1]).toMatchObject({ source: 'stripe' });
    expect(invoked).toEqual(['stripe']);
    expect(stripeHandler).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
  });

  it('does not claim unregistered sources', async () => {
    const stripeHandler = vi.fn(async () => ({ outcome: 'APPLIED' }));
    const { worker, claimBatch } = createWorker({
      handlers: { stripe: stripeHandler },
    });
    const claimedSources: Array<string | undefined> = [];
    claimBatch.mockImplementation(async (_db, options: { source?: string }) => {
      claimedSources.push(options.source);
      return { events: [], reclaimed: 0 };
    });

    const result = await worker.runTick();
    expect(claimedSources).toEqual(['stripe']);
    expect(claimedSources).not.toContain('moneris');
    expect(stripeHandler).not.toHaveBeenCalled();
    expect(result.claimed).toBe(0);
  });

  it('leaves an unregistered claimed source untouched instead of failing it', async () => {
    const stripeHandler = vi.fn(async () => ({ outcome: 'APPLIED' }));
    const { worker, markFailedOrRetry } = createWorker({
      claim: {
        events: [fakeEvent({ source: 'moneris', eventType: 'payment.authorized' })],
        reclaimed: 0,
      },
      handlers: { stripe: stripeHandler },
    });

    const result = await worker.runTick();
    expect(stripeHandler).not.toHaveBeenCalled();
    expect(markFailedOrRetry).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.retried).toBe(0);
  });

  it('does not mark PROCESSED again after a successful handler', async () => {
    const markFailedOrRetry = vi.fn();
    const { worker } = createWorker({
      claim: { events: [fakeEvent()], reclaimed: 0 },
      processEvent: async () => ({ outcome: 'APPLIED' }),
      markFailedOrRetry,
    });
    const result = await worker.runTick();
    expect(result.processed).toBe(1);
    expect(markFailedOrRetry).not.toHaveBeenCalled();
  });

  it('settles terminal handler failures without treating them as applied', async () => {
    const { worker, markFailedOrRetry } = createWorker({
      claim: { events: [fakeEvent()], reclaimed: 0 },
      processEvent: async () => {
        throw new TerminalEventError('anomaly', 'ANOMALY');
      },
    });
    const result = await worker.runTick();
    expect(result.failed).toBe(1);
    expect(markFailedOrRetry).toHaveBeenCalled();
  });
});
