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
    writeAudit: async () => undefined,
    sleep: async () => undefined,
    processEvent: options.processEvent ?? (async () => undefined),
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
