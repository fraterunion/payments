import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IdempotencyRecordStatus, type PrismaClient } from '@fraterunion-payments/database';
import { ProviderTimeoutError } from '@fraterunion-payments/provider-contracts';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigService } from '../src/config/app-config.service';
import { DatabaseService } from '../src/database/database.service';
import { hashIdempotencyKey } from '../src/idempotency/idempotency';
import { deriveProviderIdempotencyKey } from '../src/idempotency/provider-idempotency-key';
import { IDEMPOTENCY_SCOPES } from '../src/idempotency/idempotency.types';
import { providerAccountCreateFingerprint } from '../src/provider-connections/provider-connection-idempotency';
import { ProviderAccountConnectionService } from '../src/provider-connections/provider-connections.service';
import { STRIPE_CONNECT_PROVIDER } from '../src/provider-connections/stripe-connect.tokens';
import { FakeStripeConnectProvider } from './support/fake-stripe-connect-provider';
import { deleteTenantsForTests, teardownRealPgSuite } from './support/immutable-audit-cleanup';
import { resolveDatabaseUrl } from './support/test-database-url';
import { createTestEnvironment } from './support/test-environment';
import { testEmail, testSlug } from './support/test-ownership';

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl === undefined) {
  console.warn(
    'Skipping provider-connection integration suite: DATABASE_URL is not set. ' +
      'See packages/database/README.md for local setup.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)(
  'Provider connections integration (real PostgreSQL)',
  () => {
    let app: NestExpressApplication;
    let db: PrismaClient;
    let connections: ProviderAccountConnectionService;
    let fakeConnect: FakeStripeConnectProvider;
    const createdUserIds = new Set<string>();
    const createdOrgIds = new Set<string>();
    const actor = { type: 'SYSTEM' as const };

    beforeAll(async () => {
      if (databaseUrl === undefined) {
        throw new Error('DATABASE_URL must be set');
      }
      fakeConnect = new FakeStripeConnectProvider();
      const environment = createTestEnvironment({
        databaseUrl,
        swaggerEnabled: false,
        stripeEnabled: true,
        stripeSecretKey: 'sk_test_fake_not_used',
        stripeConnectReturnUrl: 'http://localhost:3000/connect/return',
        stripeConnectRefreshUrl: 'http://localhost:3000/connect/refresh',
      });
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule.forRoot(environment)],
      })
        .overrideProvider(STRIPE_CONNECT_PROVIDER)
        .useValue(fakeConnect)
        .compile();
      app = moduleRef.createNestApplication<NestExpressApplication>();
      configureApp(app, app.get(AppConfigService));
      await app.init();
      db = app.get(DatabaseService).getClient();
      connections = app.get(ProviderAccountConnectionService);
      await deleteTenantsForTests(db);
    });

    afterAll(async () => {
      await teardownRealPgSuite({
        app,
        db,
        organizationIds: [...createdOrgIds],
        userIds: [...createdUserIds],
      });
    });

    async function registerOrg(): Promise<{ organizationId: string; userId: string }> {
      const suffix = randomUUID().slice(0, 8);
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail(`pc-int-${suffix}`),
          password: `a sufficiently long passphrase ${suffix}`,
          organizationName: `PC Int ${suffix}`,
          organizationSlug: testSlug(`pc-int-${suffix}`),
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
      };
    }

    it('enforces organization FK RESTRICT, one provider per org, and no cross-bind', async () => {
      const orgA = await registerOrg();
      const orgB = await registerOrg();
      const created = await connections.createStripe(
        { organizationId: orgA.organizationId, idempotencyKey: `k-${randomUUID()}` },
        actor,
      );

      await expect(
        db.organization.delete({ where: { id: orgA.organizationId } }),
      ).rejects.toThrow();

      await expect(
        db.providerAccountConnection.create({
          data: {
            organizationId: orgA.organizationId,
            provider: 'stripe',
            providerAccountId: 'acct_second',
            status: 'PENDING',
            paymentsEnabled: false,
            payoutsEnabled: false,
            requirementsDue: false,
          },
        }),
      ).rejects.toThrow();

      await expect(
        db.providerAccountConnection.create({
          data: {
            organizationId: orgB.organizationId,
            provider: 'stripe',
            providerAccountId: created.providerAccountId,
            status: 'PENDING',
            paymentsEnabled: false,
            payoutsEnabled: false,
            requirementsDue: false,
          },
        }),
      ).rejects.toThrow();
    });

    it('keeps create + audit atomic and stores no onboarding URL or outbox row', async () => {
      const org = await registerOrg();
      const created = await connections.createStripe(
        { organizationId: org.organizationId, idempotencyKey: `k-${randomUUID()}` },
        actor,
      );
      const audits = await db.auditLog.findMany({
        where: {
          organizationId: org.organizationId,
          action: 'provider_connection.created',
          resourceId: created.id,
        },
      });
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits[0]?.metadata)).not.toContain('connect.stripe.com');
      expect(JSON.stringify(created)).not.toContain('connect.stripe.com');
      expect(
        await db.outboxEvent.count({
          where: { organizationId: org.organizationId },
        }),
      ).toBe(0);
      const columns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'provider_account_connections'`;
      expect(columns.map((column) => column.column_name).join(',')).not.toContain('url');
      expect(columns.map((column) => column.column_name).join(',')).not.toContain('stripe_');
    });

    it('resumes an IN_PROGRESS create without a second canonical connection', async () => {
      const org = await registerOrg();
      const connectionId = randomUUID();
      const idempotencyKey = `resume-${randomUUID()}`;
      const operation = await db.idempotencyRecord.create({
        data: {
          organizationId: org.organizationId,
          scope: 'provider.account.create',
          keyHash: hashIdempotencyKey(idempotencyKey),
          requestFingerprint: providerAccountCreateFingerprint(org.organizationId),
          resourceType: 'connection',
          resourceId: connectionId,
          status: IdempotencyRecordStatus.IN_PROGRESS,
        },
      });

      fakeConnect.failNext = new ProviderTimeoutError('The payment provider timed out.');
      await expect(
        connections.createStripe({ organizationId: org.organizationId, idempotencyKey }, actor),
      ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });

      const stillInProgress = await db.idempotencyRecord.findUniqueOrThrow({
        where: { id: operation.id },
      });
      expect(stillInProgress.status).toBe(IdempotencyRecordStatus.IN_PROGRESS);
      expect(
        await db.providerAccountConnection.count({
          where: { organizationId: org.organizationId },
        }),
      ).toBe(0);

      const resumed = await connections.createStripe(
        { organizationId: org.organizationId, idempotencyKey },
        actor,
      );
      expect(resumed.id).toBe(connectionId);
      expect(
        await db.providerAccountConnection.count({
          where: { organizationId: org.organizationId },
        }),
      ).toBe(1);
      const completed = await db.idempotencyRecord.findUniqueOrThrow({
        where: { id: operation.id },
      });
      expect(completed.status).toBe(IdempotencyRecordStatus.COMPLETED);
      expect(
        fakeConnect.createdIdempotencyKeys.filter(
          (key) =>
            key ===
            deriveProviderIdempotencyKey({
              provider: 'stripe',
              operation: IDEMPOTENCY_SCOPES.PROVIDER_ACCOUNT_CREATE,
              operationId: operation.id,
            }),
        ).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('rejects a different idempotency key while provisioning is in progress', async () => {
      const org = await registerOrg();
      await db.idempotencyRecord.create({
        data: {
          organizationId: org.organizationId,
          scope: 'provider.account.create',
          keyHash: hashIdempotencyKey(`in-flight-${randomUUID()}`),
          requestFingerprint: providerAccountCreateFingerprint(org.organizationId),
          resourceType: 'connection',
          resourceId: randomUUID(),
          status: IdempotencyRecordStatus.IN_PROGRESS,
        },
      });
      const before = fakeConnect.createdIdempotencyKeys.length;
      await expect(
        connections.createStripe(
          { organizationId: org.organizationId, idempotencyKey: `other-${randomUUID()}` },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_CONNECTION_CREATE_IN_PROGRESS' });
      expect(fakeConnect.createdIdempotencyKeys.length).toBe(before);
      expect(
        await db.providerAccountConnection.count({
          where: { organizationId: org.organizationId },
        }),
      ).toBe(0);
    });

    it('does not look up connections without organization scope', async () => {
      const org = await registerOrg();
      const created = await connections.createStripe(
        { organizationId: org.organizationId, idempotencyKey: `k-${randomUUID()}` },
        actor,
      );
      const other = await registerOrg();
      await expect(connections.get(other.organizationId, created.id)).rejects.toMatchObject({
        code: 'PROVIDER_CONNECTION_NOT_FOUND',
      });
    });
  },
);
