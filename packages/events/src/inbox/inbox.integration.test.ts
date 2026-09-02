import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { hashPayload } from '../hash/payload-hash.js';
import { OutboxService } from '../outbox/outbox.service.js';
import {
  cleanupOrganizations,
  cleanupPlatformEvents,
  createTestClient,
  createTestOrganization,
  describePostgres,
} from '../test/postgres.js';
import { PLATFORM_SCOPE_KEY } from '../types.js';
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
    await db.inboxEvent.deleteMany({
      where: { source: 'stripe', externalEventId: { startsWith: 'evt_fup_inbox_' } },
    });
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
    expect(first.event.payload).toEqual({ a: 1, b: 2 });

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

  it('keeps generic sources isolated across tenants while Stripe Event IDs are globally unique', async () => {
    const firstOrg = await createTestOrganization(db);
    const secondOrg = await createTestOrganization(db);
    organizationIds.push(firstOrg.id, secondOrg.id);
    const stripeEventId = `evt_fup_inbox_${randomUUID()}`;

    const platform = await inbox.receive(db, {
      source: 'stripe',
      externalEventId: stripeEventId,
      eventType: 'payment_intent.succeeded',
      payload: { id: stripeEventId, object: 'event' },
    });
    const tenant = await inbox.receive(db, {
      organizationId: firstOrg.id,
      source: 'stripe',
      externalEventId: stripeEventId,
      eventType: 'payment_intent.succeeded',
      payload: { id: stripeEventId, object: 'event' },
    });
    expect(tenant.kind).toBe('DUPLICATE');
    expect(tenant.event.id).toBe(platform.event.id);
    expect(
      await db.inboxEvent.count({ where: { source: 'stripe', externalEventId: stripeEventId } }),
    ).toBe(1);

    const conflict = await inbox.receive(db, {
      organizationId: secondOrg.id,
      source: 'stripe',
      externalEventId: stripeEventId,
      eventType: 'payment_intent.succeeded',
      payload: { id: stripeEventId, object: 'event', mutated: true },
    });
    expect(conflict.kind).toBe('CONFLICT');
    expect(conflict.event.id).toBe(platform.event.id);
    expect(conflict.event.payload).toEqual({ id: stripeEventId, object: 'event' });
  });

  it('rejects a second Stripe inbox row at the database regardless of scope', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const externalEventId = `evt_fup_inbox_${randomUUID()}`;
    const payload = { id: externalEventId, object: 'event' };
    const first = await inbox.receive(db, {
      source: 'stripe',
      externalEventId,
      eventType: 'payment_intent.succeeded',
      payload,
    });

    await expect(
      db.inboxEvent.create({
        data: {
          organizationId: org.id,
          scopeKey: org.id,
          source: 'stripe',
          externalEventId,
          eventType: 'payment_intent.succeeded',
          payload,
          payloadHash: hashPayload(payload),
          status: 'RECEIVED',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const replay = await inbox.receive(db, {
      organizationId: org.id,
      source: 'stripe',
      externalEventId,
      eventType: 'payment_intent.succeeded',
      payload,
    });
    expect(replay.kind).toBe('DUPLICATE');
    expect(replay.event.id).toBe(first.event.id);
  });

  it('promotes unresolved Stripe identity to a known tenant and never downgrades or reassigns', async () => {
    const firstOrg = await createTestOrganization(db);
    const secondOrg = await createTestOrganization(db);
    organizationIds.push(firstOrg.id, secondOrg.id);
    const externalEventId = `evt_fup_inbox_${randomUUID()}`;
    const payload = { id: externalEventId, object: 'event' };

    const received = await inbox.receive(db, {
      source: 'stripe',
      externalEventId,
      eventType: 'payment_intent.succeeded',
      payload,
    });
    expect(received.event.organizationId).toBeNull();
    expect(received.event.scopeKey).toBe(PLATFORM_SCOPE_KEY);

    const assigned = await inbox.assignOrganizationIfUnresolved(db, received.event.id, firstOrg.id);
    expect(assigned.kind).toBe('ASSIGNED');
    expect(assigned.event.organizationId).toBe(firstOrg.id);
    expect(assigned.event.scopeKey).toBe(firstOrg.id);
    expect(assigned.event.payload).toEqual(payload);

    const sameTenant = await inbox.assignOrganizationIfUnresolved(
      db,
      received.event.id,
      firstOrg.id,
    );
    expect(sameTenant.kind).toBe('UNCHANGED');

    const crossTenant = await inbox.assignOrganizationIfUnresolved(
      db,
      received.event.id,
      secondOrg.id,
    );
    expect(crossTenant.kind).toBe('TENANT_CONFLICT');
    expect(crossTenant.event.organizationId).toBe(firstOrg.id);
    expect(crossTenant.event.scopeKey).toBe(firstOrg.id);

    const laterUnknown = await inbox.receive(db, {
      source: 'stripe',
      externalEventId,
      eventType: 'payment_intent.succeeded',
      payload,
    });
    expect(laterUnknown.kind).toBe('DUPLICATE');
    expect(laterUnknown.event.organizationId).toBe(firstOrg.id);
    expect(laterUnknown.event.scopeKey).toBe(firstOrg.id);
  });

  it('deduplicates concurrent unknown and known Stripe receipts into one row', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const payload = { object: 'event', n: 1 };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const externalEventId = `evt_fup_inbox_${randomUUID()}`;
      const second = createTestClient();
      try {
        const results = await Promise.all([
          inbox.receive(db, {
            source: 'stripe',
            externalEventId,
            eventType: 'payment_intent.succeeded',
            payload,
          }),
          inbox.receive(second, {
            organizationId: org.id,
            source: 'stripe',
            externalEventId,
            eventType: 'payment_intent.succeeded',
            payload,
          }),
        ]);
        const kinds = results.map((result) => result.kind).sort();
        expect(kinds).toEqual(['DUPLICATE', 'NEW']);
        expect(results[0]?.event.id).toBe(results[1]?.event.id);

        const eventId = results[0]?.event.id;
        expect(eventId).toBeDefined();
        if (eventId === undefined) {
          throw new Error('expected inbox event id');
        }
        await inbox.assignOrganizationIfUnresolved(db, eventId, org.id);
        const rows = await db.inboxEvent.findMany({
          where: { source: 'stripe', externalEventId },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.organizationId).toBe(org.id);
        expect(rows[0]?.scopeKey).toBe(org.id);
        expect(rows[0]?.payload).toEqual(payload);
      } finally {
        await second.$disconnect();
      }
    }
  });

  it('claims one Stripe-source row across concurrent SKIP LOCKED workers', async () => {
    const org = await createTestOrganization(db);
    organizationIds.push(org.id);
    const source = `${sourcePrefix}-claim-${randomUUID().slice(0, 8)}`;
    const received = await inbox.receive(db, {
      organizationId: org.id,
      source,
      externalEventId: `claim-${randomUUID()}`,
      eventType: 'events.test',
      payload: { claim: true },
    });
    expect(received.event.status).toBe('RECEIVED');

    const [first, second] = await Promise.all([
      inbox.claimBatch(db, {
        workerId: 'worker-a',
        batchSize: 10,
        claimLeaseMs: 60_000,
        source,
      }),
      inbox.claimBatch(db, {
        workerId: 'worker-b',
        batchSize: 10,
        claimLeaseMs: 60_000,
        source,
      }),
    ]);
    const claimedIds = [...first.events, ...second.events].map((event) => event.id);
    expect(claimedIds).toHaveLength(1);
    expect(claimedIds[0]).toBe(received.event.id);
    const row = await db.inboxEvent.findUniqueOrThrow({ where: { id: received.event.id } });
    expect(row.status).toBe('PROCESSING');
    expect(row.claimedBy === 'worker-a' || row.claimedBy === 'worker-b').toBe(true);
  });

  it('proves Stripe duplicate precheck SQL would fail and current inbox rows are unique', async () => {
    const duplicates = await db.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "inbox_events"
        WHERE "source" = 'stripe'
        GROUP BY "source", "external_event_id"
        HAVING COUNT(*) > 1
      ) AS "present"
    `;
    expect(duplicates[0]?.present).toBe(false);

    await expect(
      db.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM (
              VALUES ('stripe', 'evt_precheck_dup'), ('stripe', 'evt_precheck_dup')
            ) AS probe("source", "external_event_id")
            GROUP BY "source", "external_event_id"
            HAVING COUNT(*) > 1
          ) THEN
            RAISE EXCEPTION
              'Cannot enforce global Stripe event identity: duplicate (source, external_event_id) rows exist for source=stripe. Resolve them manually before applying this migration. No inbox rows were deleted or merged.';
          END IF;
        END $$;
      `),
    ).rejects.toThrow(/Cannot enforce global Stripe event identity/);
  });
});
