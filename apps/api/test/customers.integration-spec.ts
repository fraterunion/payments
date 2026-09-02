import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@fraterunion-payments/database';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigService } from '../src/config/app-config.service';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from '../src/audit/audit.types';
import { CustomerProviderMappingsService } from '../src/customers/customer-provider-mappings.service';
import { CustomersService } from '../src/customers/customers.service';
import { deleteTenantsForTests } from './support/immutable-audit-cleanup';
import { createTestEnvironment } from './support/test-environment';

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
    'Skipping customer integration suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)(
  'Customers integration (real PostgreSQL)',
  () => {
    let app: NestExpressApplication;
    let db: PrismaClient;
    let customers: CustomersService;
    let mappings: CustomerProviderMappingsService;
    let audit: AuditService;

    const createdUserIds = new Set<string>();
    const createdOrgIds = new Set<string>();

    beforeAll(async () => {
      if (databaseUrl === undefined) {
        throw new Error('DATABASE_URL must be set');
      }
      const environment = createTestEnvironment({ databaseUrl, swaggerEnabled: false });
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule.forRoot(environment)],
      }).compile();
      app = moduleRef.createNestApplication<NestExpressApplication>();
      configureApp(app, app.get(AppConfigService));
      await app.init();
      db = app.get(DatabaseService).getClient();
      customers = app.get(CustomersService);
      mappings = app.get(CustomerProviderMappingsService);
      audit = app.get(AuditService);
    });

    afterAll(async () => {
      if (db !== undefined) {
        await deleteTenantsForTests(db, [...createdOrgIds], [...createdUserIds]);
      }
      if (app !== undefined) {
        await app.close();
      }
    });

    async function registerOrg(): Promise<{
      organizationId: string;
      userId: string;
      accessToken: string;
    }> {
      const suffix = randomUUID().slice(0, 8);
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `owner-${suffix}@example.com`,
          password: `a sufficiently long passphrase ${suffix}`,
          organizationName: `Org ${suffix}`,
          organizationSlug: `org-${suffix}`,
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(201);
      createdUserIds.add(response.body.user.id as string);
      createdOrgIds.add(response.body.organization.id as string);
      return {
        organizationId: response.body.organization.id as string,
        userId: response.body.user.id as string,
        accessToken: response.body.accessToken as string,
      };
    }

    const actor = { type: 'SYSTEM' as const };

    it('creates customers, canonicalizes email, and allows duplicate emails', async () => {
      const { organizationId } = await registerOrg();
      const first = await customers.create(
        { organizationId, email: '  Ada@Example.COM  ', name: 'Ada' },
        actor,
      );
      const second = await customers.create(
        { organizationId, email: 'ada@example.com', name: 'Ada Two' },
        actor,
      );
      expect(first.email).toBe('ada@example.com');
      expect(second.email).toBe('ada@example.com');
      expect(first.id).not.toBe(second.id);
    });

    it('enforces externalReference uniqueness per organization and allows reuse across orgs', async () => {
      const a = await registerOrg();
      const b = await registerOrg();
      await customers.create(
        { organizationId: a.organizationId, externalReference: 'member-1' },
        actor,
      );
      await expect(
        customers.create(
          { organizationId: a.organizationId, externalReference: 'member-1' },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'CUSTOMER_EXTERNAL_REFERENCE_EXISTS' });
      const other = await customers.create(
        { organizationId: b.organizationId, externalReference: 'member-1' },
        actor,
      );
      expect(other.externalReference).toBe('member-1');
    });

    it('rejects one of two concurrent creates with the same externalReference', async () => {
      const { organizationId } = await registerOrg();
      const results = await Promise.allSettled([
        customers.create({ organizationId, externalReference: 'race-ref' }, actor),
        customers.create({ organizationId, externalReference: 'race-ref' }, actor),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'CUSTOMER_EXTERNAL_REFERENCE_EXISTS',
      });
      expect(
        await db.customer.count({ where: { organizationId, externalReference: 'race-ref' } }),
      ).toBe(1);
    });

    it('archives with CHECK consistency and keeps mappings readable', async () => {
      const { organizationId } = await registerOrg();
      const customer = await customers.create({ organizationId, name: 'Keep' }, actor);
      await mappings.create(
        {
          organizationId,
          customerId: customer.id,
          provider: 'example',
          providerCustomerId: 'cus_keep',
        },
        actor,
      );
      const archived = await customers.archive(organizationId, customer.id, actor);
      expect(archived.status).toBe('ARCHIVED');
      expect(archived.archivedAt).not.toBeNull();
      const listed = await mappings.listForCustomer(organizationId, customer.id);
      expect(listed).toHaveLength(1);
      await expect(
        mappings.create(
          {
            organizationId,
            customerId: customer.id,
            provider: 'acme',
            providerCustomerId: 'cus_new',
          },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'CUSTOMER_ARCHIVED' });
    });

    it('enforces provider mapping uniqueness and concurrent races', async () => {
      const { organizationId } = await registerOrg();
      const customer = await customers.create({ organizationId, name: 'Mapped' }, actor);
      await mappings.create(
        {
          organizationId,
          customerId: customer.id,
          provider: 'example',
          providerCustomerId: 'cus_dup',
        },
        actor,
      );
      await expect(
        mappings.create(
          {
            organizationId,
            customerId: customer.id,
            provider: 'example',
            providerCustomerId: 'cus_other',
          },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'CUSTOMER_PROVIDER_MAPPING_EXISTS' });

      const other = await customers.create({ organizationId, name: 'Other' }, actor);
      await expect(
        mappings.create(
          {
            organizationId,
            customerId: other.id,
            provider: 'example',
            providerCustomerId: 'cus_dup',
          },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_CUSTOMER_ALREADY_MAPPED' });

      const raceCustomer = await customers.create({ organizationId, name: 'Race' }, actor);
      const raced = await Promise.allSettled([
        mappings.create(
          {
            organizationId,
            customerId: raceCustomer.id,
            provider: 'example',
            providerCustomerId: 'cus_race',
          },
          actor,
        ),
        mappings.create(
          {
            organizationId,
            customerId: raceCustomer.id,
            provider: 'example',
            providerCustomerId: 'cus_race',
          },
          actor,
        ),
      ]);
      expect(raced.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(raced.filter((r) => r.status === 'rejected')).toHaveLength(1);
    });

    it('allows the same provider customer id in a different account scope or organization', async () => {
      const a = await registerOrg();
      const b = await registerOrg();
      const customerA = await customers.create(
        { organizationId: a.organizationId, name: 'A' },
        actor,
      );
      const customerB = await customers.create(
        { organizationId: b.organizationId, name: 'B' },
        actor,
      );
      await mappings.create(
        {
          organizationId: a.organizationId,
          customerId: customerA.id,
          provider: 'example',
          providerCustomerId: 'cus_shared',
        },
        actor,
      );
      await mappings.create(
        {
          organizationId: a.organizationId,
          customerId: customerA.id,
          provider: 'example',
          providerCustomerId: 'cus_shared',
          providerAccountReference: 'acct_connected',
        },
        actor,
      );
      await mappings.create(
        {
          organizationId: b.organizationId,
          customerId: customerB.id,
          provider: 'example',
          providerCustomerId: 'cus_shared',
        },
        actor,
      );
      expect(
        await mappings.findByProviderCustomer({
          organizationId: a.organizationId,
          provider: 'example',
          providerCustomerId: 'cus_shared',
        }),
      ).not.toBeNull();
    });

    it('rolls back a customer mutation when audit is rejected', async () => {
      const { organizationId } = await registerOrg();
      await expect(
        db.$transaction(async (tx) => {
          await tx.customer.create({
            data: { organizationId, name: 'Rollback' },
          });
          await audit.write(tx, {
            organizationId,
            actor,
            action: AUDIT_ACTIONS.CUSTOMER_CREATED,
            resource: { type: AUDIT_RESOURCE_TYPES.CUSTOMER },
            metadata: { password: 'nope' },
          });
        }),
      ).rejects.toThrow(/forbidden/);
      expect(
        await db.customer.findFirst({ where: { organizationId, name: 'Rollback' } }),
      ).toBeNull();
    });

    it('enforces archive and metadata CHECK constraints', async () => {
      const { organizationId } = await registerOrg();
      await expect(
        db.customer.create({
          data: { organizationId, name: 'Broken', status: 'ARCHIVED' },
        }),
      ).rejects.toThrow(/customers_status_archived_at_consistent/);
      await expect(
        db.$executeRaw`
          INSERT INTO customers (id, organization_id, type, status, metadata, created_at, updated_at)
          VALUES (
            gen_random_uuid(),
            ${organizationId}::uuid,
            'INDIVIDUAL',
            'ACTIVE',
            '[]'::jsonb,
            NOW(),
            NOW()
          )
        `,
      ).rejects.toThrow(/customers_metadata_object/);
    });

    it('does not enqueue customer outbox events', async () => {
      const { organizationId } = await registerOrg();
      const created = await customers.create({ organizationId, name: 'Silent' }, actor);
      await customers.update(organizationId, created.id, { name: 'Still Silent' }, actor);
      await customers.archive(organizationId, created.id, actor);
      const events = await db.outboxEvent.findMany({
        where: { organizationId, eventType: { startsWith: 'customer.' } },
      });
      expect(events).toHaveLength(0);
    });

    it('restricts physical deletion of organizations that own customers', async () => {
      const { organizationId } = await registerOrg();
      await customers.create({ organizationId, name: 'Pinned' }, actor);
      await expect(db.organization.delete({ where: { id: organizationId } })).rejects.toThrow();
    });

    it('stores only safe identifiers in audit metadata', async () => {
      const { organizationId } = await registerOrg();
      const created = await customers.create(
        { organizationId, email: 'pii@example.com', phone: '+15551234567', name: 'PII' },
        actor,
      );
      const row = await db.auditLog.findFirstOrThrow({
        where: { organizationId, action: 'customer.created', resourceId: created.id },
      });
      const metadata = row.metadata as Record<string, unknown>;
      expect(metadata['hasEmail']).toBe(true);
      expect(metadata['hasPhone']).toBe(true);
      expect(JSON.stringify(metadata)).not.toContain('pii@example.com');
      expect(JSON.stringify(metadata)).not.toContain('+15551234567');
      expect(JSON.stringify(metadata)).not.toContain('PII');
    });
  },
);
