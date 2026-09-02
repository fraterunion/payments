import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { OutboxService } from '../outbox/outbox.service.js';
import {
  cleanupOrganizations,
  cleanupPlatformEvents,
  createTestClient,
  createTestOrganization,
  describePostgres,
} from '../test/postgres.js';
import { InboxService } from './inbox.service.js';

describePostgres('InboxService (real PostgreSQL)', () => {
  const db = createTestClient();
  const inbox = new InboxService();
  const outbox = new OutboxService();
  const organizationIds: string[] = [];
  const sourcePrefix = `events-test-inbox-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await cleanupPlatformEvents(db, { sourcePrefix: 'events-test-inbox-' });
    await cleanupOrganizations(db, organizationIds);
    await db.$disconnect();
  });

  it('classifies first receipt, same-payload duplicate, and payload conflict', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const externalEventId = `evt-${randomUUID()}`;

    const first = await inbox.receive(db, {
      organizationId: org.id,
      source: sourcePrefix,
      externalEventId,
      eventType: 'events.test',
      payload: { a: 1, b: 2 },
    });
    expect(first.kind).toBe('NEW');

    const duplicate = await inbox.receive(db, {
      organizationId: org.id,
      source: sourcePrefix,
      externalEventId,
      eventType: 'events.test',
      payload: { b: 2, a: 1 },
    });
    expect(duplicate.kind).toBe('DUPLICATE');
    expect(duplicate.event.id).toBe(first.event.id);
    expect(duplicate.event.payloadHash).toBe(first.event.payloadHash);

    const conflict = await inbox.receive(db, {
      organizationId: org.id,
      source: sourcePrefix,
      externalEventId,
      eventType: 'events.test',
      payload: { a: 1, b: 99 },
    });
    expect(conflict.kind).toBe('CONFLICT');
    expect(conflict.event.payloadHash).toBe(first.event.payloadHash);
  });

  it('deduplicates concurrent arrivals of the same identity', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const externalEventId = `evt-concurrent-${randomUUID()}`;
    const input = {
      organizationId: org.id,
      source: sourcePrefix,
      externalEventId,
      eventType: 'events.test',
      payload: { n: 1 },
    };

    const second = createTestClient();
    try {
      const results = await Promise.all([inbox.receive(db, input), inbox.receive(second, input)]);
      const kinds = results.map((result) => result.kind).sort();
      expect(kinds).toEqual(['DUPLICATE', 'NEW']);
      expect(results[0]?.event.id).toBe(results[1]?.event.id);
    } finally {
      await second.$disconnect();
    }
  });

  it('isolates the same external id across tenants and platform scope', async () => {
    const firstOrg = await createTestOrganization(db);
    const secondOrg = await createTestOrganization(db);
    organizationIds.push(firstOrg.id, secondOrg.id);
    const externalEventId = `shared-${randomUUID()}`;

    const tenantA = await inbox.receive(db, {
      organizationId: firstOrg.id,
      source: sourcePrefix,
      externalEventId,
      eventType: 'events.test',
      payload: { tenant: 'a' },
    });
    const tenantB = await inbox.receive(db, {
      organizationId: secondOrg.id,
      source: sourcePrefix,
      externalEventId,
      eventType: 'events.test',
      payload: { tenant: 'b' },
    });
    const platform = await inbox.receive(db, {
      source: sourcePrefix,
      externalEventId,
      eventType: 'events.test',
      payload: { tenant: 'platform' },
    });

    expect(new Set([tenantA.event.id, tenantB.event.id, platform.event.id]).size).toBe(3);
    expect(platform.event.organizationId).toBeNull();
    expect(platform.event.scopeKey).toBe('platform');
  });

  it('does not run logical processing twice for a processed event', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    let executions = 0;
    const externalEventId = `once-${randomUUID()}`;

    const first = await inbox.receive(db, {
      organizationId: org.id,
      source: sourcePrefix,
      externalEventId,
      eventType: 'events.test',
      payload: { once: true },
    });
    expect(first.kind).toBe('NEW');
    executions += 1;
    await inbox.beginProcessing(db, first.event.id);
    await inbox.markProcessed(db, first.event.id);

    const second = await inbox.receive(db, {
      organizationId: org.id,
      source: sourcePrefix,
      externalEventId,
      eventType: 'events.test',
      payload: { once: true },
    });
    expect(second.kind).toBe('DUPLICATE');
    expect(second.event.status).toBe('PROCESSED');
    if (second.kind === 'NEW') {
      executions += 1;
    }
    expect(executions).toBe(1);
  });

  it('rolls back inbox state, a domain mutation, and an outbox enqueue together', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const externalEventId = `chain-${randomUUID()}`;
    const outboxType = `events.test.chain.${randomUUID().slice(0, 8)}`;

    await expect(
      db.$transaction(async (tx) => {
        const received = await inbox.receive(tx, {
          organizationId: org.id,
          source: sourcePrefix,
          externalEventId,
          eventType: 'events.test',
          payload: { chain: true },
        });
        expect(received.kind).toBe('NEW');
        await inbox.beginProcessing(tx, received.event.id);
        await tx.organization.update({
          where: { id: org.id },
          data: { metadata: { chain: true } },
        });
        await outbox.enqueue(tx, {
          organizationId: org.id,
          eventType: outboxType,
          payload: { from: 'inbox' },
          causationId: received.event.id,
        });
        await inbox.markProcessed(tx, received.event.id);
        throw new Error('force chain rollback');
      }),
    ).rejects.toThrow('force chain rollback');

    expect(
      await db.inboxEvent.findFirst({
        where: { source: sourcePrefix, externalEventId },
      }),
    ).toBeNull();
    expect(await db.outboxEvent.findFirst({ where: { eventType: outboxType } })).toBeNull();
    const organization = await db.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(organization.metadata).toEqual({});
  });

  it('commits the inbox + domain + outbox chain atomically', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const externalEventId = `chain-ok-${randomUUID()}`;
    const outboxType = `events.test.chainok.${randomUUID().slice(0, 8)}`;

    await db.$transaction(async (tx) => {
      const received = await inbox.receive(tx, {
        organizationId: org.id,
        source: sourcePrefix,
        externalEventId,
        eventType: 'events.test',
        payload: { chain: 'ok' },
      });
      await inbox.beginProcessing(tx, received.event.id);
      await tx.organization.update({
        where: { id: org.id },
        data: { metadata: { chain: 'ok' } },
      });
      await outbox.enqueue(tx, {
        organizationId: org.id,
        eventType: outboxType,
        payload: { from: 'inbox' },
      });
      await inbox.markProcessed(tx, received.event.id);
    });

    const inboxRow = await db.inboxEvent.findFirstOrThrow({
      where: { source: sourcePrefix, externalEventId },
    });
    expect(inboxRow.status).toBe('PROCESSED');
    expect(await db.outboxEvent.findFirst({ where: { eventType: outboxType } })).not.toBeNull();
    const organization = await db.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(organization.metadata).toEqual({ chain: 'ok' });
  });

  it('transitions RECEIVED → PROCESSING → PROCESSED and refuses a second logical start', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const received = await inbox.receive(db, {
      organizationId: org.id,
      source: sourcePrefix,
      externalEventId: `states-${randomUUID()}`,
      eventType: 'events.test',
      payload: { state: true },
    });
    expect(received.event.status).toBe('RECEIVED');

    const processing = await inbox.beginProcessing(db, received.event.id);
    expect(processing.status).toBe('PROCESSING');
    expect(processing.processingStartedAt).toBeTruthy();

    const processed = await inbox.markProcessed(db, received.event.id);
    expect(processed.status).toBe('PROCESSED');
    expect(processed.processedAt).toBeTruthy();

    await expect(inbox.beginProcessing(db, received.event.id)).rejects.toMatchObject({
      code: 'ALREADY_PROCESSED',
    });
  });
});
