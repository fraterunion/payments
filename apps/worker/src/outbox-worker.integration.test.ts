import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import pino from 'pino';
import {
  EventHandlerRegistry,
  OutboxService,
  RetryableEventError,
  TerminalEventError,
} from '@fraterunion-payments/events';
import type { WorkerEnvironment } from './config/environment.types.js';
import { OutboxWorker } from './outbox-worker.js';
import {
  cleanupOrganizations,
  createTestClient,
  createTestOrganization,
  describePostgres,
} from './test/postgres.js';

function environment(overrides: Partial<WorkerEnvironment> = {}): WorkerEnvironment {
  return {
    nodeEnv: 'test',
    databaseUrl: 'postgresql://user:password@localhost:5432/test',
    logLevel: 'info',
    pollIntervalMs: 40,
    batchSize: 25,
    claimLeaseMs: 2_000,
    maxAttempts: 10,
    retryBaseMs: 1_000,
    retryMaxMs: 900_000,
    concurrency: 3,
    shutdownTimeoutMs: 2_000,
    ...overrides,
  };
}

async function waitForEvent(
  db: ReturnType<typeof createTestClient>,
  eventId: string,
  predicate: (row: { status: string; attemptCount: number }) => boolean,
  timeoutMs = 4_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = await db.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (predicate(row)) {
      return row;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
  }
  throw new Error(`Timed out waiting for outbox event ${eventId}`);
}

describePostgres('OutboxWorker (real PostgreSQL)', () => {
  const db = createTestClient();
  const outbox = new OutboxService();
  const organizationIds: string[] = [];
  const prefix = `events.test.worker.${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await cleanupOrganizations(db, organizationIds);
    await db.$disconnect();
  });

  function createWorker(registry: EventHandlerRegistry, env: WorkerEnvironment = environment()) {
    return new OutboxWorker({
      database: db,
      outbox,
      registry,
      environment: env,
      logger: pino({ level: 'silent' }),
      workerId: `worker-${randomUUID()}`,
      claimEventTypePrefix: prefix,
      sleep: async (ms) => {
        await new Promise((resolve) => {
          setTimeout(resolve, ms);
        });
      },
    });
  }

  it('starts, claims, dispatches, marks PROCESSED, and stops', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const eventType = `${prefix}.ok`;
    const created = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType,
      payload: { ok: true },
    });

    const registry = new EventHandlerRegistry();
    let executions = 0;
    registry.register(eventType, async () => {
      executions += 1;
    });

    const worker = createWorker(registry);
    await worker.start();
    const processed = await waitForEvent(db, created.id, (row) => row.status === 'PROCESSED');
    await worker.stop();

    expect(executions).toBe(1);
    expect(processed.processedAt).toBeTruthy();
    expect(processed.id).toBe(created.id);
  });

  it('schedules retryable failures and fails terminal and unknown types immediately', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);

    const retryType = `${prefix}.retry`;
    const terminalType = `${prefix}.terminal`;
    const unknownType = `${prefix}.unknown`;

    const retrying = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType: retryType,
      payload: {},
    });
    const terminal = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType: terminalType,
      payload: {},
    });
    const unknown = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType: unknownType,
      payload: {},
    });

    const registry = new EventHandlerRegistry();
    registry.register(retryType, async () => {
      throw new RetryableEventError('temporary');
    });
    registry.register(terminalType, async () => {
      throw new TerminalEventError('schema mismatch', 'SCHEMA');
    });

    const worker = new OutboxWorker({
      database: db,
      outbox,
      registry,
      environment: environment(),
      logger: pino({ level: 'silent' }),
      workerId: `worker-${randomUUID()}`,
      claimEventTypePrefix: prefix,
      random: () => 1,
      sleep: async (ms) => {
        await new Promise((resolve) => {
          setTimeout(resolve, ms);
        });
      },
    });

    await worker.start();
    const retried = await waitForEvent(
      db,
      retrying.id,
      (row) => row.status === 'PENDING' && row.attemptCount === 1,
    );
    const failed = await waitForEvent(db, terminal.id, (row) => row.status === 'FAILED');
    const unknownFailed = await waitForEvent(db, unknown.id, (row) => row.status === 'FAILED');
    await worker.stop();

    expect(retried.attemptCount).toBe(1);
    expect(retried.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(failed.lastErrorCode).toBe('SCHEMA');
    expect(unknownFailed.lastErrorCode).toBe('UNKNOWN_EVENT_TYPE');
  });

  it('marks FAILED after the attempt budget is exhausted', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const eventType = `${prefix}.exhausted`;
    const created = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType,
      payload: {},
    });
    await db.outboxEvent.update({ where: { id: created.id }, data: { attemptCount: 9 } });

    const registry = new EventHandlerRegistry();
    registry.register(eventType, async () => {
      throw new RetryableEventError('still failing');
    });

    const worker = createWorker(registry);
    await worker.start();
    const failed = await waitForEvent(db, created.id, (row) => row.status === 'FAILED');
    await worker.stop();
    expect(failed.attemptCount).toBe(10);
  });

  it('eventually processes an expired claim', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const eventType = `${prefix}.reclaim`;
    const created = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType,
      payload: {},
    });

    await outbox.claimBatch(db, {
      workerId: 'crashed-worker',
      batchSize: 50,
      claimLeaseMs: 1,
      eventTypePrefix: prefix,
    });
    await db.outboxEvent.update({
      where: { id: created.id },
      data: { claimExpiresAt: new Date(Date.now() - 1_000) },
    });

    const registry = new EventHandlerRegistry();
    registry.register(eventType, async () => undefined);
    const worker = createWorker(registry);
    await worker.start();
    const processed = await waitForEvent(db, created.id, (row) => row.status === 'PROCESSED');
    await worker.stop();
    expect(processed.status).toBe('PROCESSED');
  });

  it('stops cleanly so the process can disconnect the database', async () => {
    const isolated = createTestClient();
    const registry = new EventHandlerRegistry();
    const worker = new OutboxWorker({
      database: isolated,
      outbox,
      registry,
      environment: environment(),
      logger: pino({ level: 'silent' }),
      workerId: `worker-${randomUUID()}`,
      sleep: async () => undefined,
    });

    await isolated.$connect();
    await isolated.$queryRaw`SELECT 1`;
    await worker.start();
    await worker.stop();
    await expect(isolated.$disconnect()).resolves.toBeUndefined();
  });
});
