import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import type { PrismaClient } from '@fraterunion-payments/database';
import { AuditService } from '../src/audit/audit.service';
import { UnsafeAuditMetadataError } from '../src/audit/audit-metadata';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from '../src/audit/audit.types';
import { deleteTenantsForTests } from './support/immutable-audit-cleanup';

if (process.env['DATABASE_URL'] === undefined) {
  for (const candidate of [
    resolve(__dirname, '../../../packages/database/.env'),
    resolve(process.cwd(), '../../packages/database/.env'),
  ]) {
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      break;
    }
  }
}

const databaseUrl = process.env['DATABASE_URL'];

if (databaseUrl === undefined) {
  console.warn(
    'Skipping audit integration suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)(
  'Audit immutability (real PostgreSQL)',
  () => {
    let db: PrismaClient;
    let audit: AuditService;
    const organizationIds: string[] = [];
    const userIds: string[] = [];

    beforeAll(async () => {
      if (databaseUrl === undefined) {
        throw new Error('DATABASE_URL must be set');
      }
      const { createPrismaClient } = await import('@fraterunion-payments/database');
      db = createPrismaClient({ connectionString: databaseUrl });
      await db.$connect();
      audit = new AuditService({
        setContext: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      } as never);
    });

    afterAll(async () => {
      await deleteTenantsForTests(db, organizationIds, userIds);
      await db.$disconnect();
    });

    async function createOrg(): Promise<{ id: string }> {
      const slug = `audit-test-${randomUUID().slice(0, 8)}`;
      const organization = await db.organization.create({
        data: {
          name: `Audit ${slug}`,
          slug,
          type: 'BUSINESS',
          status: 'ACTIVE',
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        },
      });
      organizationIds.push(organization.id);
      return organization;
    }

    async function createUser(): Promise<{ id: string }> {
      const user = await db.user.create({
        data: {
          email: `audit-${randomUUID().slice(0, 8)}@example.com`,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }

    async function createApiKey(organizationId: string, name: string): Promise<{ id: string }> {
      return db.apiKey.create({
        data: {
          organizationId,
          name,
          keyPrefix: randomUUID().replace(/-/g, '').slice(0, 12),
          secretHash: `hash-${randomUUID()}`,
          status: 'ACTIVE',
          environment: 'TEST',
          scopes: [],
        },
      });
    }

    it('allows INSERT and blocks UPDATE and DELETE', async () => {
      const org = await createOrg();
      const created = await audit.write(db, {
        organizationId: org.id,
        actor: { type: 'SYSTEM' },
        action: AUDIT_ACTIONS.AUTH_REGISTERED,
        resource: { type: AUDIT_RESOURCE_TYPES.ORGANIZATION, id: org.id },
        metadata: { ok: true },
      });

      await expect(
        db.auditLog.update({ where: { id: created.id }, data: { action: 'tamper' } }),
      ).rejects.toThrow(/audit_logs is append-only/);

      await expect(db.auditLog.delete({ where: { id: created.id } })).rejects.toThrow(
        /audit_logs is append-only/,
      );

      await expect(
        db.$executeRaw`UPDATE audit_logs SET action = 'x' WHERE id = ${created.id}::uuid`,
      ).rejects.toThrow(/audit_logs is append-only/);
      await expect(
        db.$executeRaw`DELETE FROM audit_logs WHERE id = ${created.id}::uuid`,
      ).rejects.toThrow(/audit_logs is append-only/);

      const reloaded = await db.auditLog.findUniqueOrThrow({ where: { id: created.id } });
      expect(reloaded.action).toBe('auth.registered');
      expect(reloaded.metadata).toEqual({ ok: true });
    });

    it('allows user, API-key, and system actors and rejects both actor refs', async () => {
      const org = await createOrg();
      const user = await createUser();
      const apiKey = await createApiKey(org.id, 'audit-test');

      const asUser = await audit.write(db, {
        organizationId: org.id,
        actor: { type: 'USER', userId: user.id },
        action: 'auth.example',
        resource: { type: 'user', id: user.id },
      });
      expect(asUser.actorUserId).toBe(user.id);
      expect(asUser.actorApiKeyId).toBeNull();

      const asKey = await audit.write(db, {
        organizationId: org.id,
        actor: { type: 'API_KEY', apiKeyId: apiKey.id },
        action: 'api_key.example',
        resource: { type: 'api_key', id: apiKey.id },
      });
      expect(asKey.actorApiKeyId).toBe(apiKey.id);
      expect(asKey.actorUserId).toBeNull();

      const asSystem = await audit.write(db, {
        organizationId: org.id,
        actor: { type: 'SYSTEM' },
        action: 'system.example',
        resource: { type: 'organization', id: org.id },
      });
      expect(asSystem.actorUserId).toBeNull();
      expect(asSystem.actorApiKeyId).toBeNull();

      await expect(
        db.$executeRaw`
        INSERT INTO audit_logs (
          id, organization_id, actor_user_id, actor_api_key_id, action, resource_type, metadata, created_at
        ) VALUES (
          ${randomUUID()}::uuid, ${org.id}::uuid, ${user.id}::uuid, ${apiKey.id}::uuid,
          'bad.actor', 'user', '{}'::jsonb, NOW()
        )
      `,
      ).rejects.toThrow(/audit_logs_not_both_actors|violates check constraint/);
    });

    it('rejects empty action, empty resource type, and non-object metadata', async () => {
      const org = await createOrg();

      await expect(
        audit.write(db, {
          organizationId: org.id,
          actor: { type: 'SYSTEM' },
          action: '   ',
          resource: { type: 'user' },
        }),
      ).rejects.toThrow(/action/);

      await expect(
        db.auditLog.create({
          data: {
            organizationId: org.id,
            action: '',
            resourceType: 'user',
          },
        }),
      ).rejects.toThrow(/audit_logs_action_nonempty|violates check constraint/);

      await expect(
        db.auditLog.create({
          data: {
            organizationId: org.id,
            action: 'x',
            resourceType: '',
          },
        }),
      ).rejects.toThrow(/audit_logs_resource_type_nonempty|violates check constraint/);

      await expect(
        db.$executeRaw`
        INSERT INTO audit_logs (id, organization_id, action, resource_type, metadata, created_at)
        VALUES (${randomUUID()}::uuid, ${org.id}::uuid, 'x', 'user', '[]'::jsonb, NOW())
      `,
      ).rejects.toThrow(/audit_logs_metadata_object|violates check constraint/);
    });

    it('commits a mutation with its audit row and rolls both back when audit is rejected', async () => {
      const org = await createOrg();

      await db.$transaction(async (tx) => {
        await tx.organization.update({
          where: { id: org.id },
          data: { metadata: { marker: 'commit' } },
        });
        await audit.write(tx, {
          organizationId: org.id,
          actor: { type: 'SYSTEM' },
          action: 'org.example',
          resource: { type: 'organization', id: org.id },
          metadata: { marker: 'commit' },
        });
      });

      expect(
        await db.auditLog.findFirst({ where: { organizationId: org.id, action: 'org.example' } }),
      ).not.toBeNull();
      expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).metadata).toEqual(
        {
          marker: 'commit',
        },
      );

      await expect(
        db.$transaction(async (tx) => {
          await tx.organization.update({
            where: { id: org.id },
            data: { metadata: { marker: 'rollback' } },
          });
          await audit.write(tx, {
            organizationId: org.id,
            actor: { type: 'SYSTEM' },
            action: 'org.rollback',
            resource: { type: 'organization', id: org.id },
            metadata: { password: 'should-reject' },
          });
        }),
      ).rejects.toBeInstanceOf(UnsafeAuditMetadataError);

      expect(await db.auditLog.findFirst({ where: { action: 'org.rollback' } })).toBeNull();
      expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).metadata).toEqual(
        {
          marker: 'commit',
        },
      );
    });

    it('can compose mutation + audit + outbox in one transaction and roll all three back', async () => {
      const org = await createOrg();
      const outboxType = `events.test.audit.${randomUUID().slice(0, 8)}`;

      await expect(
        db.$transaction(async (tx) => {
          await tx.organization.update({
            where: { id: org.id },
            data: { metadata: { chain: true } },
          });
          await audit.write(tx, {
            organizationId: org.id,
            actor: { type: 'SYSTEM' },
            action: 'org.chain',
            resource: { type: 'organization', id: org.id },
          });
          await tx.outboxEvent.create({
            data: { organizationId: org.id, eventType: outboxType, payload: { chain: true } },
          });
          throw new Error('force chain rollback');
        }),
      ).rejects.toThrow('force chain rollback');

      expect(
        await db.auditLog.findFirst({ where: { organizationId: org.id, action: 'org.chain' } }),
      ).toBeNull();
      expect(await db.outboxEvent.findFirst({ where: { eventType: outboxType } })).toBeNull();
      expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).metadata).toEqual(
        {},
      );
    });

    it('lists tenant-scoped pages with deterministic (createdAt, id) cursors and no cross-org leakage', async () => {
      const orgA = await createOrg();
      const orgB = await createOrg();
      const user = await createUser();

      await audit.write(db, {
        organizationId: orgA.id,
        actor: { type: 'USER', userId: user.id },
        action: 'auth.login_succeeded',
        resource: { type: 'user', id: user.id },
        requestContext: { requestId: 'req-a' },
      });
      await audit.write(db, {
        organizationId: orgA.id,
        actor: { type: 'SYSTEM' },
        action: 'api_key.created',
        resource: { type: 'api_key', id: randomUUID() },
      });
      await audit.write(db, {
        organizationId: orgB.id,
        actor: { type: 'SYSTEM' },
        action: 'auth.login_succeeded',
        resource: { type: 'user' },
      });

      const first = await audit.list(db, { organizationId: orgA.id, limit: 1 });
      expect(first.items).toHaveLength(1);
      expect(first.items[0]?.organizationId).toBe(orgA.id);
      expect(first.nextCursor).toBeDefined();

      if (first.nextCursor === undefined) {
        throw new Error('expected a next cursor after the first page');
      }
      const second = await audit.list(db, {
        organizationId: orgA.id,
        limit: 1,
        cursor: first.nextCursor,
      });
      expect(second.items).toHaveLength(1);
      expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
      expect(second.items.every((row) => row.organizationId === orgA.id)).toBe(true);

      const byAction = await audit.list(db, {
        organizationId: orgA.id,
        action: 'auth.login_succeeded',
      });
      expect(byAction.items).toHaveLength(1);
      expect(byAction.items[0]?.actorUserId).toBe(user.id);

      const byRequest = await audit.list(db, { organizationId: orgA.id, requestId: 'req-a' });
      expect(byRequest.items).toHaveLength(1);

      const leaked = await audit.list(db, { organizationId: orgA.id });
      expect(leaked.items.some((row) => row.organizationId === orgB.id)).toBe(false);

      const byActor = await audit.list(db, { organizationId: orgA.id, actorUserId: user.id });
      expect(byActor.items).toHaveLength(1);
      expect(byActor.items[0]?.actorUserId).toBe(user.id);

      const byResource = await audit.list(db, {
        organizationId: orgA.id,
        resourceType: 'api_key',
      });
      expect(byResource.items).toHaveLength(1);
      expect(byResource.items[0]?.resourceType).toBe('api_key');

      const afterAllRows = await audit.list(db, {
        organizationId: orgA.id,
        createdAtFrom: new Date(Date.now() + 60_000),
      });
      expect(afterAllRows.items).toHaveLength(0);
    });

    it('preserves audit evidence and restricts physical deletion of referenced actors and orgs', async () => {
      const org = await createOrg();
      const user = await createUser();
      const apiKey = await createApiKey(org.id, 'keep');

      const row = await audit.write(db, {
        organizationId: org.id,
        actor: { type: 'USER', userId: user.id },
        action: 'auth.registered',
        resource: { type: 'user', id: user.id },
      });
      await audit.write(db, {
        organizationId: org.id,
        actor: { type: 'API_KEY', apiKeyId: apiKey.id },
        action: 'api_key.created',
        resource: { type: 'api_key', id: apiKey.id },
      });

      await expect(db.user.delete({ where: { id: user.id } })).rejects.toThrow();
      await expect(db.apiKey.delete({ where: { id: apiKey.id } })).rejects.toThrow();
      await expect(db.organization.delete({ where: { id: org.id } })).rejects.toThrow();

      const preserved = await db.auditLog.findUniqueOrThrow({ where: { id: row.id } });
      expect(preserved.actorUserId).toBe(user.id);
      expect(preserved.organizationId).toBe(org.id);
    });
  },
);
