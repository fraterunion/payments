import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { RetryableEventError, TerminalEventError } from '../errors.js';
import {
  cleanupOrganizations,
  cleanupPlatformEvents,
  createTestClient,
  createTestOrganization,
  describePostgres,
} from '../test/postgres.js';
import { DEFAULT_RETRY_POLICY } from '../types.js';
import { OutboxService } from './outbox.service.js';

describePostgres('OutboxService (real PostgreSQL)', () => {
  const db = createTestClient();
  const outbox = new OutboxService();
  const organizationIds: string[] = [];
  const eventType = `events.test.outbox.${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await cleanupPlatformEvents(db, { eventTypePrefix: 'events.test.outbox.' });
    await cleanupOrganizations(db, organizationIds);
    await db.$disconnect();
  });

  it('enqueues an event and keeps the same id through processing', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);

    const created = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType,
      payload: { kind: 'stable-id' },
      metadata: { schemaVersion: 1 },
    });

    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.status).toBe('PENDING');
    expect(created.attemptCount).toBe(0);

    const { events: claimed } = await outbox.claimBatch(db, {
      workerId: 'worker-a',
      batchSize: 10,
      claimLeaseMs: 60_000,
      eventTypePrefix: eventType,
    });
    const match = claimed.find((event) => event.id === created.id);
    expect(match?.id).toBe(created.id);
    expect(match?.status).toBe('PROCESSING');
    expect(match?.claimedBy).toBe('worker-a');
    expect(match?.claimedAt).toBeTruthy();
    expect(match?.claimExpiresAt).toBeTruthy();
  });

  it('commits the outbox row with the surrounding transaction and rolls it back with the transaction', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);

    const committedType = `${eventType}.commit`;
    await db.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: org.id },
        data: { metadata: { marker: 'commit' } },
      });
      await outbox.enqueue(tx, {
        organizationId: org.id,
        eventType: committedType,
        payload: { ok: true },
      });
    });
    expect(await db.outboxEvent.findFirst({ where: { eventType: committedType } })).not.toBeNull();

    const rolledBackType = `${eventType}.rollback`;
    await expect(
      db.$transaction(async (tx) => {
        await tx.organization.update({
          where: { id: org.id },
          data: { metadata: { marker: 'rollback' } },
        });
        await outbox.enqueue(tx, {
          organizationId: org.id,
          eventType: rolledBackType,
          payload: { ok: false },
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    expect(await db.outboxEvent.findFirst({ where: { eventType: rolledBackType } })).toBeNull();
    const organization = await db.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(organization.metadata).toEqual({ marker: 'commit' });
  });

  it('does not claim an event scheduled in the future', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const futureType = `${eventType}.future`;
    const created = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType: futureType,
      payload: {},
      availableAt: new Date(Date.now() + 60_000),
    });

    const { events: claimed } = await outbox.claimBatch(db, {
      workerId: 'worker-future',
      batchSize: 50,
      claimLeaseMs: 60_000,
      eventTypePrefix: futureType,
    });
    expect(claimed.some((event) => event.id === created.id)).toBe(false);
  });

  it('does not assign the same event to two concurrent claimers', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const prefix = `${eventType}.race.`;
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        outbox.enqueue(db, {
          organizationId: org.id,
          eventType: `${prefix}${index}`,
          payload: { index },
        }),
      ),
    );

    const second = createTestClient();
    try {
      const [firstBatch, secondBatch] = await Promise.all([
        outbox.claimBatch(db, {
          workerId: 'claimer-1',
          batchSize: 100,
          claimLeaseMs: 60_000,
          eventTypePrefix: prefix,
        }),
        outbox.claimBatch(second, {
          workerId: 'claimer-2',
          batchSize: 100,
          claimLeaseMs: 60_000,
          eventTypePrefix: prefix,
        }),
      ]);

      const firstIds = firstBatch.events
        .filter((event) => event.eventType.startsWith(prefix))
        .map((event) => event.id);
      const secondIds = secondBatch.events
        .filter((event) => event.eventType.startsWith(prefix))
        .map((event) => event.id);
      const overlap = firstIds.filter((id) => secondIds.includes(id));
      expect(overlap).toEqual([]);
      expect(new Set([...firstIds, ...secondIds]).size).toBe(created.length);
    } finally {
      await second.$disconnect();
    }
  });

  it('reclaims an expired PROCESSING lease', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const created = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType: `${eventType}.lease`,
      payload: {},
    });

    const firstClaim = await outbox.claimBatch(db, {
      workerId: 'worker-a',
      batchSize: 50,
      claimLeaseMs: 1,
      eventTypePrefix: `${eventType}.lease`,
    });
    expect(firstClaim.events.some((event) => event.id === created.id)).toBe(true);

    await db.outboxEvent.update({
      where: { id: created.id },
      data: { claimExpiresAt: new Date(Date.now() - 1_000) },
    });

    const secondClaim = await outbox.claimBatch(db, {
      workerId: 'worker-b',
      batchSize: 50,
      claimLeaseMs: 60_000,
      eventTypePrefix: `${eventType}.lease`,
    });
    const reclaimed = secondClaim.events.find((event) => event.id === created.id);
    expect(secondClaim.reclaimed).toBeGreaterThanOrEqual(1);
    expect(reclaimed?.claimedBy).toBe('worker-b');
    expect(reclaimed?.status).toBe('PROCESSING');
  });

  it('marks processed, retries with scheduled availableAt, and fails terminally', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);

    const processed = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType: `${eventType}.ok`,
      payload: {},
    });
    await outbox.markProcessed(db, processed.id);
    const stored = await db.outboxEvent.findUniqueOrThrow({ where: { id: processed.id } });
    expect(stored.status).toBe('PROCESSED');
    expect(stored.processedAt).toBeTruthy();

    const retrying = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType: `${eventType}.retry`,
      payload: {},
    });
    const retried = await outbox.markFailedOrRetry(
      db,
      retrying,
      new RetryableEventError('temporary'),
      {
        retryPolicy: DEFAULT_RETRY_POLICY,
        random: () => 1,
      },
    );
    expect(retried.status).toBe('PENDING');
    expect(retried.attemptCount).toBe(1);
    expect(retried.availableAt.getTime()).toBeGreaterThan(Date.now() - 1_000);
    expect(retried.lastErrorMessage).toBe('temporary');
    expect(retried.lastErrorMessage).not.toMatch(/stack|prisma/i);

    const terminal = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType: `${eventType}.terminal`,
      payload: {},
    });
    const failed = await outbox.markFailedOrRetry(
      db,
      terminal,
      new TerminalEventError('schema mismatch', 'SCHEMA'),
      { retryPolicy: DEFAULT_RETRY_POLICY },
    );
    expect(failed.status).toBe('FAILED');
    expect(failed.attemptCount).toBe(1);

    const exhausted = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType: `${eventType}.exhausted`,
      payload: {},
    });
    await db.outboxEvent.update({ where: { id: exhausted.id }, data: { attemptCount: 9 } });
    const dead = await outbox.markFailedOrRetry(
      db,
      { id: exhausted.id, attemptCount: 9 },
      new RetryableEventError('still failing'),
      { retryPolicy: DEFAULT_RETRY_POLICY },
    );
    expect(dead.status).toBe('FAILED');
    expect(dead.attemptCount).toBe(10);
  });

  it('allows a platform event with no organizationId', async () => {
    const created = await outbox.enqueue(db, {
      eventType: `${eventType}.platform`,
      payload: { system: true },
    });
    expect(created.organizationId).toBeNull();
  });

  it('persists payload and metadata without rewriting the event id', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const created = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType: `${eventType}.payload`,
      aggregateType: 'Organization',
      aggregateId: org.id,
      payload: { a: 1 },
      metadata: { requestId: 'req-1' },
      correlationId: 'corr-1',
      causationId: 'cause-1',
    });
    const reloaded = await db.outboxEvent.findUniqueOrThrow({ where: { id: created.id } });
    expect(reloaded.payload).toEqual({ a: 1 });
    expect(reloaded.metadata).toEqual({ requestId: 'req-1' });
    expect(reloaded.correlationId).toBe('corr-1');
    expect(reloaded.causationId).toBe('cause-1');
    expect(reloaded.id).toBe(created.id);
  });

  it('persists a sanitized error summary without stacks or secrets', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const created = await outbox.enqueue(db, {
      organizationId: org.id,
      eventType: `${eventType}.sanitize`,
      payload: {},
    });
    const failed = await outbox.markFailedOrRetry(
      db,
      created,
      new Error(
        'connect failed postgresql://user:supersecret@localhost:5432/db\n    at Worker.run (worker.ts:1:1)',
      ),
      { retryPolicy: DEFAULT_RETRY_POLICY },
    );
    expect(failed.lastErrorCode).toBe('UNEXPECTED');
    expect(failed.lastErrorMessage).not.toContain('supersecret');
    expect(failed.lastErrorMessage).not.toContain('at Worker.run');
    expect(failed.lastErrorMessage).toContain('[REDACTED]');
  });
});
