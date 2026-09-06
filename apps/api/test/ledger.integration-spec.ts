import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createPrismaClient, type PrismaClient } from '@fraterunion-payments/database';
import { InboxService } from '@fraterunion-payments/events';
import { LEDGER_ACCOUNT_TYPES, LEDGER_SIDES } from '@fraterunion-payments/ledger-core';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AuditService } from '../src/audit/audit.service';
import { AppConfigService } from '../src/config/app-config.service';
import { DatabaseService } from '../src/database/database.service';
import { LedgerAccountsService } from '../src/ledger/ledger-accounts.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { PaymentProviderExecutionService } from '../src/payments/payment-provider-execution.service';
import { PaymentsService } from '../src/payments/payments.service';
import { RefundProviderExecutionService } from '../src/refunds/refund-provider-execution.service';
import { RefundsService } from '../src/refunds/refunds.service';
import { StripeInboxProcessorService } from '../src/webhooks/stripe-inbox-processor.service';
import { deleteTenantsForTests, teardownRealPgSuite } from './support/immutable-audit-cleanup';
import {
  stripeFinancialEvent,
  stripePaymentIntentObject,
  stripeRefundObject,
} from './support/stripe-financial-event';
import {
  postStripeWebhook,
  signStripeWebhook,
  TEST_STRIPE_WEBHOOK_SECRET,
} from './support/stripe-webhook';
import { resolveDatabaseUrl } from './support/test-database-url';
import { createTestEnvironment } from './support/test-environment';
import { testEmail, testSlug } from './support/test-ownership';

const databaseUrl = resolveDatabaseUrl();

if (databaseUrl === undefined) {
  console.warn('Skipping ledger suite: DATABASE_URL is not set. See packages/database/README.md.');
}

(databaseUrl === undefined ? describe.skip : describe)(
  'Append-only double-entry ledger (real PostgreSQL)',
  () => {
    let app: NestExpressApplication;
    let db: PrismaClient;
    let accounts: LedgerAccountsService;
    let ledger: LedgerService;
    let payments: PaymentsService;
    let refunds: RefundsService;
    let paymentExecutions: PaymentProviderExecutionService;
    let refundExecutions: RefundProviderExecutionService;
    let processor: StripeInboxProcessorService;
    const inbox = new InboxService();
    const createdUserIds = new Set<string>();
    const createdOrgIds = new Set<string>();
    const actor = { type: 'SYSTEM' as const };

    beforeAll(async () => {
      if (databaseUrl === undefined) {
        throw new Error('DATABASE_URL must be set');
      }
      const environment = createTestEnvironment({
        databaseUrl,
        swaggerEnabled: false,
        stripeWebhookSecret: TEST_STRIPE_WEBHOOK_SECRET,
      });
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule.forRoot(environment)],
      }).compile();
      app = moduleRef.createNestApplication<NestExpressApplication>();
      configureApp(app, app.get(AppConfigService));
      await app.init();
      await app.listen(0);
      db = app.get(DatabaseService).getClient();
      accounts = app.get(LedgerAccountsService);
      ledger = app.get(LedgerService);
      payments = app.get(PaymentsService);
      refunds = app.get(RefundsService);
      paymentExecutions = app.get(PaymentProviderExecutionService);
      refundExecutions = app.get(RefundProviderExecutionService);
      processor = app.get(StripeInboxProcessorService);
      await deleteTenantsForTests(db);
    });

    afterAll(async () => {
      await db.inboxEvent.deleteMany({
        where: { source: 'stripe', externalEventId: { startsWith: 'evt_fup_led_' } },
      });
      await teardownRealPgSuite({
        app,
        db,
        organizationIds: [...createdOrgIds],
        userIds: [...createdUserIds],
      });
    });

    async function registerOrg(): Promise<string> {
      const suffix = randomUUID().slice(0, 8);
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail(`led-${suffix}`),
          password: `a sufficiently long passphrase ${suffix}`,
          organizationName: `Ledger ${suffix}`,
          organizationSlug: testSlug(`led-${suffix}`),
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(201);
      createdUserIds.add(response.body.user.id as string);
      createdOrgIds.add(response.body.organization.id as string);
      return response.body.organization.id as string;
    }

    async function chart(organizationId: string) {
      const asset = await accounts.create(
        {
          organizationId,
          code: `CASH.${randomUUID().slice(0, 8)}`,
          name: 'Cash',
          type: LEDGER_ACCOUNT_TYPES.ASSET,
          currency: 'USD',
        },
        actor,
      );
      const revenue = await accounts.create(
        {
          organizationId,
          code: `REV.${randomUUID().slice(0, 8)}`,
          name: 'Revenue',
          type: LEDGER_ACCOUNT_TYPES.REVENUE,
          currency: 'USD',
        },
        actor,
      );
      return { asset, revenue };
    }

    function balanced(assetId: string, revenueId: string, amount = 10000n) {
      return [
        { accountId: assetId, side: LEDGER_SIDES.DEBIT, amount },
        { accountId: revenueId, side: LEDGER_SIDES.CREDIT, amount },
      ];
    }

    it('applied the double-entry ledger migration', async () => {
      const rows = await db.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM _prisma_migrations
        WHERE migration_name = '20260902230000_add_double_entry_ledger'
      `;
      expect(rows).toHaveLength(1);
    });

    it('applies every migration on a fresh database, seeds, and posts a balanced journal', async () => {
      const databaseDir = resolve(__dirname, '../../../packages/database');
      const freshName = `fup_led_fresh_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const adminUrl = new URL(databaseUrl);
      adminUrl.pathname = '/postgres';
      const freshUrl = new URL(databaseUrl);
      freshUrl.pathname = `/${freshName}`;
      const admin = createPrismaClient({ connectionString: adminUrl.toString() });
      await admin.$executeRawUnsafe(`CREATE DATABASE "${freshName}"`);
      const fresh = createPrismaClient({ connectionString: freshUrl.toString() });
      try {
        execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
          cwd: databaseDir,
          env: { ...process.env, DATABASE_URL: freshUrl.toString() },
          stdio: 'pipe',
        });
        execFileSync('pnpm', ['exec', 'prisma', 'db', 'seed'], {
          cwd: databaseDir,
          env: { ...process.env, DATABASE_URL: freshUrl.toString() },
          stdio: 'pipe',
        });
        const org = await fresh.organization.findFirstOrThrow({ where: { slug: 'fraterunion' } });
        const asset = await fresh.ledgerAccount.create({
          data: {
            organizationId: org.id,
            code: 'CASH',
            name: 'Cash',
            type: 'ASSET',
            currency: 'USD',
          },
        });
        const revenue = await fresh.ledgerAccount.create({
          data: {
            organizationId: org.id,
            code: 'REV',
            name: 'Revenue',
            type: 'REVENUE',
            currency: 'USD',
          },
        });
        await fresh.ledgerTransaction.create({
          data: {
            organizationId: org.id,
            transactionType: 'test.posting',
            currency: 'USD',
            entries: {
              create: [
                { ledgerAccountId: asset.id, side: 'DEBIT', amount: 10000n },
                { ledgerAccountId: revenue.id, side: 'CREDIT', amount: 10000n },
              ],
            },
          },
        });
        const totals = await fresh.$queryRaw<Array<{ debit_total: bigint; credit_total: bigint }>>`
          SELECT
            COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN amount ELSE 0 END), 0)::bigint AS debit_total,
            COALESCE(SUM(CASE WHEN side = 'CREDIT' THEN amount ELSE 0 END), 0)::bigint AS credit_total
          FROM ledger_entries
          WHERE organization_id = ${org.id}::uuid
            AND ledger_account_id = ${asset.id}::uuid
        `;
        expect(typeof totals[0]?.debit_total).toBe('bigint');
        expect(totals[0]?.debit_total).toBe(10000n);
        expect(totals[0]?.credit_total).toBe(0n);
      } finally {
        await fresh.$disconnect();
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${freshName}"`);
        await admin.$disconnect();
      }
    }, 60_000);

    it('posts a balanced journal and derives signed balances as bigint strings', async () => {
      const organizationId = await registerOrg();
      const { asset, revenue } = await chart(organizationId);
      const posted = await ledger.postTransaction({
        organizationId,
        idempotencyKey: `led-${randomUUID()}`,
        transactionType: 'test.posting',
        currency: 'USD',
        entries: balanced(asset.id, revenue.id),
      });
      expect(posted.entries).toHaveLength(2);
      const cash = await ledger.getAccountBalance(organizationId, asset.id);
      const rev = await ledger.getAccountBalance(organizationId, revenue.id);
      expect(cash).toEqual({ amount: '10000', currency: 'USD' });
      expect(rev).toEqual({ amount: '10000', currency: 'USD' });
      expect(typeof cash.amount).toBe('string');
      expect(Number.isSafeInteger(Number(cash.amount))).toBe(true);
    });

    it('rejects unbalanced, one-entry, zero, and negative amounts', async () => {
      const organizationId = await registerOrg();
      const { asset, revenue } = await chart(organizationId);
      await expect(
        ledger.postTransaction({
          organizationId,
          idempotencyKey: `led-${randomUUID()}`,
          transactionType: 'test.posting',
          currency: 'USD',
          entries: [
            { accountId: asset.id, side: 'DEBIT', amount: 100n },
            { accountId: revenue.id, side: 'CREDIT', amount: 90n },
          ],
        }),
      ).rejects.toMatchObject({ code: 'LEDGER_TRANSACTION_UNBALANCED' });
      await expect(
        ledger.postTransaction({
          organizationId,
          idempotencyKey: `led-${randomUUID()}`,
          transactionType: 'test.posting',
          currency: 'USD',
          entries: [{ accountId: asset.id, side: 'DEBIT', amount: 100n }],
        }),
      ).rejects.toMatchObject({ code: 'LEDGER_TRANSACTION_TOO_FEW_ENTRIES' });
      await expect(
        ledger.postTransaction({
          organizationId,
          idempotencyKey: `led-${randomUUID()}`,
          transactionType: 'test.posting',
          currency: 'USD',
          entries: [
            { accountId: asset.id, side: 'DEBIT', amount: 0n },
            { accountId: revenue.id, side: 'CREDIT', amount: 0n },
          ],
        }),
      ).rejects.toMatchObject({ code: 'LEDGER_INVALID_AMOUNT' });
      await expect(
        ledger.postTransaction({
          organizationId,
          idempotencyKey: `led-${randomUUID()}`,
          transactionType: 'test.posting',
          currency: 'USD',
          entries: [
            { accountId: asset.id, side: 'DEBIT', amount: -5n },
            { accountId: revenue.id, side: 'CREDIT', amount: 5n },
          ],
        }),
      ).rejects.toMatchObject({ code: 'LEDGER_INVALID_AMOUNT' });
      expect(await db.ledgerTransaction.count({ where: { organizationId } })).toBe(0);
    });

    it('rejects archived, cross-tenant, and cross-currency postings', async () => {
      const organizationId = await registerOrg();
      const otherOrg = await registerOrg();
      const { asset, revenue } = await chart(organizationId);
      const foreign = await chart(otherOrg);
      await accounts.archive(organizationId, revenue.id, actor);
      await expect(
        ledger.postTransaction({
          organizationId,
          idempotencyKey: `led-${randomUUID()}`,
          transactionType: 'test.posting',
          currency: 'USD',
          entries: balanced(asset.id, revenue.id),
        }),
      ).rejects.toMatchObject({ code: 'LEDGER_ACCOUNT_ARCHIVED' });
      await expect(
        ledger.postTransaction({
          organizationId,
          idempotencyKey: `led-${randomUUID()}`,
          transactionType: 'test.posting',
          currency: 'USD',
          entries: balanced(asset.id, foreign.revenue.id),
        }),
      ).rejects.toMatchObject({ code: 'LEDGER_CROSS_TENANT_ACCOUNT' });
      await expect(
        ledger.getAccountBalance(organizationId, foreign.asset.id),
      ).rejects.toMatchObject({
        code: 'LEDGER_ACCOUNT_NOT_FOUND',
      });
      const mxn = await accounts.create(
        {
          organizationId,
          code: `MXN.${randomUUID().slice(0, 8)}`,
          name: 'MXN cash',
          type: LEDGER_ACCOUNT_TYPES.ASSET,
          currency: 'MXN',
        },
        actor,
      );
      await expect(
        ledger.postTransaction({
          organizationId,
          idempotencyKey: `led-${randomUUID()}`,
          transactionType: 'test.posting',
          currency: 'USD',
          entries: balanced(asset.id, mxn.id),
        }),
      ).rejects.toMatchObject({ code: 'LEDGER_CURRENCY_MISMATCH' });
    });

    it('rejects direct SQL mutation, delete, and truncate of immutable ledger tables', async () => {
      const organizationId = await registerOrg();
      const { asset, revenue } = await chart(organizationId);
      const posted = await ledger.postTransaction({
        organizationId,
        idempotencyKey: `led-${randomUUID()}`,
        transactionType: 'test.posting',
        currency: 'USD',
        entries: balanced(asset.id, revenue.id),
      });
      await expect(
        db.$executeRaw`UPDATE ledger_transactions SET description = 'mutated' WHERE id = ${posted.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        db.$executeRaw`DELETE FROM ledger_transactions WHERE id = ${posted.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        db.$executeRaw`UPDATE ledger_entries SET amount = 1 WHERE ledger_transaction_id = ${posted.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        db.$executeRaw`DELETE FROM ledger_entries WHERE ledger_transaction_id = ${posted.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(db.$executeRaw`TRUNCATE ledger_entries`).rejects.toThrow(/append-only/);
      await expect(db.$executeRaw`TRUNCATE ledger_transactions, ledger_entries`).rejects.toThrow(
        /append-only/,
      );
    });

    it('restricts organization delete and account identity mutation', async () => {
      const organizationId = await registerOrg();
      const { asset, revenue } = await chart(organizationId);
      await ledger.postTransaction({
        organizationId,
        idempotencyKey: `led-${randomUUID()}`,
        transactionType: 'test.posting',
        currency: 'USD',
        entries: balanced(asset.id, revenue.id),
      });
      await expect(
        db.$executeRaw`UPDATE ledger_accounts SET type = 'EXPENSE' WHERE id = ${asset.id}::uuid`,
      ).rejects.toThrow(/immutable/);
      await expect(
        db.$executeRaw`DELETE FROM ledger_accounts WHERE id = ${asset.id}::uuid`,
      ).rejects.toThrow(/cannot be deleted/);
      await expect(db.organization.delete({ where: { id: organizationId } })).rejects.toThrow();
    });

    it('replays the same idempotency key and conflicts on a different fingerprint', async () => {
      const organizationId = await registerOrg();
      const { asset, revenue } = await chart(organizationId);
      const key = `led-${randomUUID()}`;
      const first = await ledger.postTransaction({
        organizationId,
        idempotencyKey: key,
        transactionType: 'test.posting',
        currency: 'USD',
        entries: balanced(asset.id, revenue.id, 2500n),
      });
      const replay = await ledger.postTransaction({
        organizationId,
        idempotencyKey: key,
        transactionType: 'test.posting',
        currency: 'USD',
        entries: [
          { accountId: revenue.id, side: 'CREDIT', amount: 2500n },
          { accountId: asset.id, side: 'DEBIT', amount: 2500n },
        ],
      });
      expect(replay.id).toBe(first.id);
      expect(await db.ledgerTransaction.count({ where: { organizationId } })).toBe(1);
      await expect(
        ledger.postTransaction({
          organizationId,
          idempotencyKey: key,
          transactionType: 'test.posting',
          currency: 'USD',
          entries: balanced(asset.id, revenue.id, 3000n),
        }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
    });

    it('serializes ten concurrent same-key posts into one transaction', async () => {
      const organizationId = await registerOrg();
      const { asset, revenue } = await chart(organizationId);
      const key = `led-${randomUUID()}`;
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          ledger.postTransaction({
            organizationId,
            idempotencyKey: key,
            transactionType: 'test.posting',
            currency: 'USD',
            entries: balanced(asset.id, revenue.id, 111n),
          }),
        ),
      );
      const ids = new Set(results.map((row) => row.id));
      expect(ids.size).toBe(1);
      expect(await db.ledgerTransaction.count({ where: { organizationId } })).toBe(1);
      expect(await db.ledgerEntry.count({ where: { organizationId } })).toBe(2);
    });

    it('rolls back account creation when audit fails and posting when metadata is unsafe', async () => {
      const organizationId = await registerOrg();
      const audit = app.get(AuditService);
      const spy = jest.spyOn(audit, 'write').mockRejectedValueOnce(new Error('audit boom'));
      await expect(
        accounts.create(
          {
            organizationId,
            code: `FAIL.${randomUUID().slice(0, 8)}`,
            name: 'Fail',
            type: LEDGER_ACCOUNT_TYPES.ASSET,
            currency: 'USD',
          },
          actor,
        ),
      ).rejects.toThrow(/audit boom/);
      spy.mockRestore();
      expect(await db.ledgerAccount.count({ where: { organizationId } })).toBe(0);

      const { asset, revenue } = await chart(organizationId);
      await expect(
        ledger.postTransaction({
          organizationId,
          idempotencyKey: `led-${randomUUID()}`,
          transactionType: 'test.posting',
          currency: 'USD',
          metadata: { apiKey: 'sk_live_secret' },
          entries: balanced(asset.id, revenue.id),
        }),
      ).rejects.toThrow(/not allowed/);
      expect(await db.ledgerTransaction.count({ where: { organizationId } })).toBe(0);
    });

    it('rejects direct SQL unbalanced and under-populated journals at commit', async () => {
      const organizationId = await registerOrg();
      const { asset } = await chart(organizationId);
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO ledger_transactions (id, organization_id, transaction_type, currency, metadata, posted_at, created_at)
            VALUES (gen_random_uuid(), ${organizationId}::uuid, 'test.sql', 'USD', '{}'::jsonb, NOW(), NOW())
          `;
        }),
      ).rejects.toThrow(/at least two entries/);

      await expect(
        db.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<Array<{ id: string }>>`
            INSERT INTO ledger_transactions (id, organization_id, transaction_type, currency, metadata, posted_at, created_at)
            VALUES (gen_random_uuid(), ${organizationId}::uuid, 'test.sql', 'USD', '{}'::jsonb, NOW(), NOW())
            RETURNING id
          `;
          await tx.$executeRaw`
            INSERT INTO ledger_entries (id, organization_id, ledger_transaction_id, ledger_account_id, side, amount, created_at)
            VALUES (gen_random_uuid(), ${organizationId}::uuid, ${rows[0]!.id}::uuid, ${asset.id}::uuid, 'DEBIT', 10, NOW())
          `;
        }),
      ).rejects.toThrow(/at least two entries/);

      await expect(
        db.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<Array<{ id: string }>>`
            INSERT INTO ledger_transactions (id, organization_id, transaction_type, currency, metadata, posted_at, created_at)
            VALUES (gen_random_uuid(), ${organizationId}::uuid, 'test.sql', 'USD', '{}'::jsonb, NOW(), NOW())
            RETURNING id
          `;
          await tx.$executeRaw`
            INSERT INTO ledger_entries (id, organization_id, ledger_transaction_id, ledger_account_id, side, amount, created_at)
            VALUES
              (gen_random_uuid(), ${organizationId}::uuid, ${rows[0]!.id}::uuid, ${asset.id}::uuid, 'DEBIT', 10, NOW()),
              (gen_random_uuid(), ${organizationId}::uuid, ${rows[0]!.id}::uuid, ${asset.id}::uuid, 'CREDIT', 7, NOW())
          `;
        }),
      ).rejects.toThrow(/unbalanced/);
    });

    async function ingestAndClaim(event: Record<string, unknown>) {
      const payload = JSON.stringify(event);
      await postStripeWebhook(app.getHttpServer(), payload, signStripeWebhook(payload)).expect(200);
      const row = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: String(event['id']) },
      });
      return inbox.beginProcessing(db, row.id);
    }

    it('does not post ledger rows when Payment or Refund succeed via webhooks', async () => {
      const organizationId = await registerOrg();
      const created = await payments.create(
        {
          organizationId,
          amount: '10000',
          currency: 'USD',
          captureMethod: 'AUTOMATIC',
          idempotencyKey: `pay-${randomUUID()}`,
        },
        actor,
      );
      const payment = await payments.beginAuthorization(organizationId, created.id, actor);
      const pi = `pi_led_${randomUUID().slice(0, 8)}`;
      const paymentExecution = await paymentExecutions.create(
        {
          organizationId,
          paymentId: payment.id,
          provider: 'stripe',
          providerPaymentId: pi,
        },
        actor,
      );
      const beforeTx = await db.ledgerTransaction.count();
      const beforeEntry = await db.ledgerEntry.count();
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent('payment_intent.succeeded', stripePaymentIntentObject({ id: pi }), {
            id: `evt_fup_led_pi_${randomUUID().slice(0, 8)}`,
          }),
        ),
      );
      const succeeded = await db.payment.findFirstOrThrow({ where: { id: payment.id } });
      expect(succeeded.status).toBe('SUCCEEDED');

      const refund = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '2500',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const re = `re_led_${randomUUID().slice(0, 8)}`;
      await refundExecutions.create(
        {
          organizationId,
          refundId: refund.id,
          paymentProviderExecutionId: paymentExecution.id,
          providerRefundId: re,
        },
        actor,
      );
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'refund.updated',
            stripeRefundObject({ id: re, payment_intent: pi, amount: 2500 }),
            { id: `evt_fup_led_re_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      const updatedRefund = await db.refund.findFirstOrThrow({ where: { id: refund.id } });
      const updatedPayment = await db.payment.findFirstOrThrow({ where: { id: payment.id } });
      expect(updatedRefund.status).toBe('SUCCEEDED');
      expect(updatedPayment.refundedAmount).toBe(2500n);
      expect(await db.ledgerTransaction.count()).toBe(beforeTx);
      expect(await db.ledgerEntry.count()).toBe(beforeEntry);
    });
  },
);
