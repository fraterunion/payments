import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  LedgerAccountBindingRole,
  LedgerAccountType,
  type PrismaClient,
} from '@fraterunion-payments/database';
import { InboxService } from '@fraterunion-payments/events';
import {
  ensureProviderLedgerAccounts,
  getLedgerAccountBalance,
} from '@fraterunion-payments/ledger-application';
import {
  ensurePaymentCaptureLedgerPosting,
  processStripeInboxEvent,
} from '@fraterunion-payments/payment-application';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AuditService } from '../src/audit/audit.service';
import { AppConfigService } from '../src/config/app-config.service';
import { DatabaseService } from '../src/database/database.service';
import { LedgerAccountsService } from '../src/ledger/ledger-accounts.service';
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
  console.warn(
    'Skipping payment ledger suite: DATABASE_URL is not set. See packages/database/README.md.',
  );
}

(databaseUrl === undefined ? describe.skip : describe)(
  'Payment and refund ledger posting (real PostgreSQL)',
  () => {
    let app: NestExpressApplication;
    let db: PrismaClient;
    let accounts: LedgerAccountsService;
    let payments: PaymentsService;
    let refunds: RefundsService;
    let paymentExecutions: PaymentProviderExecutionService;
    let refundExecutions: RefundProviderExecutionService;
    let processor: StripeInboxProcessorService;
    let audit: AuditService;
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
      payments = app.get(PaymentsService);
      refunds = app.get(RefundsService);
      paymentExecutions = app.get(PaymentProviderExecutionService);
      refundExecutions = app.get(RefundProviderExecutionService);
      processor = app.get(StripeInboxProcessorService);
      audit = app.get(AuditService);
      await deleteTenantsForTests(db);
    });

    afterAll(async () => {
      await db.inboxEvent.deleteMany({
        where: { source: 'stripe', externalEventId: { startsWith: 'evt_fup_pled_' } },
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
          email: testEmail(`pled-${suffix}`),
          password: `a sufficiently long passphrase ${suffix}`,
          organizationName: `Payment Ledger ${suffix}`,
          organizationSlug: testSlug(`pled-${suffix}`),
          defaultCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
        })
        .expect(201);
      createdUserIds.add(response.body.user.id as string);
      createdOrgIds.add(response.body.organization.id as string);
      return response.body.organization.id as string;
    }

    async function authorizingPayment(
      organizationId: string,
      captureMethod: 'AUTOMATIC' | 'MANUAL' = 'AUTOMATIC',
      amount = '10000',
    ) {
      const created = await payments.create(
        {
          organizationId,
          amount,
          currency: 'USD',
          captureMethod,
          idempotencyKey: `pay-${randomUUID()}`,
        },
        actor,
      );
      return payments.beginAuthorization(organizationId, created.id, actor);
    }

    async function bindPayment(
      organizationId: string,
      paymentId: string,
      providerPaymentId: string,
      providerAccountReference?: string,
      provider = 'stripe',
    ) {
      return paymentExecutions.create(
        {
          organizationId,
          paymentId,
          provider,
          providerPaymentId,
          ...(providerAccountReference !== undefined ? { providerAccountReference } : {}),
        },
        actor,
      );
    }

    async function ingestAndClaim(event: Record<string, unknown>) {
      const payload = JSON.stringify(event);
      await postStripeWebhook(app.getHttpServer(), payload, signStripeWebhook(payload)).expect(200);
      const row = await db.inboxEvent.findFirstOrThrow({
        where: { source: 'stripe', externalEventId: String(event['id']) },
      });
      return inbox.beginProcessing(db, row.id);
    }

    async function writeAudit(
      client: Parameters<AuditService['write']>[0],
      input: {
        readonly organizationId: string;
        readonly action: string;
        readonly resourceType: string;
        readonly resourceId: string;
        readonly metadata: Record<string, unknown>;
      },
    ) {
      await audit.write(client, {
        organizationId: input.organizationId,
        actor,
        action: input.action,
        resource: { type: input.resourceType, id: input.resourceId },
        metadata: input.metadata,
      });
    }

    async function succeedPayment(
      organizationId: string,
      paymentId: string,
      pi: string,
      amountReceived = 10000,
      eventId = `evt_fup_pled_${randomUUID().slice(0, 8)}`,
    ) {
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'payment_intent.succeeded',
            stripePaymentIntentObject({
              id: pi,
              amount: 10000,
              amount_received: amountReceived,
            }),
            { id: eventId },
          ),
        ),
      );
      return db.payment.findFirstOrThrow({ where: { id: paymentId, organizationId } });
    }

    async function journalCounts(organizationId: string) {
      const [transactions, entries, captures, refundJournals] = await Promise.all([
        db.ledgerTransaction.count({ where: { organizationId } }),
        db.ledgerEntry.count({ where: { organizationId } }),
        db.ledgerTransaction.count({
          where: { organizationId, transactionType: 'payment.capture' },
        }),
        db.ledgerTransaction.count({ where: { organizationId, transactionType: 'refund' } }),
      ]);
      return { transactions, entries, captures, refundJournals };
    }

    async function clearingBalances(
      organizationId: string,
      provider: string,
      providerAccountScope: string,
    ) {
      const receivable = await db.ledgerAccountBinding.findFirstOrThrow({
        where: {
          organizationId,
          role: LedgerAccountBindingRole.PROVIDER_RECEIVABLE,
          provider,
          providerAccountScope,
          currency: 'USD',
        },
      });
      const payable = await db.ledgerAccountBinding.findFirstOrThrow({
        where: {
          organizationId,
          role: LedgerAccountBindingRole.SETTLEMENT_PAYABLE,
          provider,
          providerAccountScope,
          currency: 'USD',
        },
      });
      return {
        receivable: await getLedgerAccountBalance(db, organizationId, receivable.ledgerAccountId),
        payable: await getLedgerAccountBalance(db, organizationId, payable.ledgerAccountId),
      };
    }

    async function createAccount(
      organizationId: string,
      type: LedgerAccountType,
      currency = 'USD',
    ) {
      return db.ledgerAccount.create({
        data: {
          organizationId,
          code: `TST.${type}.${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
          name: `${type} fixture`,
          type,
          currency,
        },
      });
    }

    function isRetryable(error: unknown): boolean {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      return (
        code === 'LEDGER_CONCURRENCY_CONFLICT' ||
        code === 'IDEMPOTENCY_OPERATION_IN_PROGRESS' ||
        code === 'P2034' ||
        code === '25P02'
      );
    }

    async function settle<T>(work: () => Promise<T>): Promise<T> {
      let last: unknown;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          return await work();
        } catch (error) {
          last = error;
          if (!isRetryable(error)) {
            throw error;
          }
        }
      }
      throw last;
    }

    it('applied the ledger account bindings migration', async () => {
      const rows = await db.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM _prisma_migrations
        WHERE migration_name = '20260902240000_add_ledger_account_bindings'
      `;
      expect(rows).toHaveLength(1);
      const balanceColumns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ledger_accounts'
          AND column_name IN ('balance', 'available_balance', 'current_balance')
      `;
      expect(balanceColumns).toEqual([]);
    });

    it('enforces one binding per role/provider/scope/currency and rejects illegal binds', async () => {
      const organizationId = await registerOrg();
      const otherOrg = await registerOrg();
      const asset = await createAccount(organizationId, LedgerAccountType.ASSET);
      const liability = await createAccount(organizationId, LedgerAccountType.LIABILITY);
      const foreign = await createAccount(otherOrg, LedgerAccountType.ASSET);
      const usdExpense = await createAccount(organizationId, LedgerAccountType.EXPENSE);

      const receivable = await db.ledgerAccountBinding.create({
        data: {
          organizationId,
          role: LedgerAccountBindingRole.PROVIDER_RECEIVABLE,
          provider: 'stripe',
          providerAccountScope: 'default',
          currency: 'USD',
          ledgerAccountId: asset.id,
        },
      });
      await expect(
        db.ledgerAccountBinding.create({
          data: {
            organizationId,
            role: LedgerAccountBindingRole.PROVIDER_RECEIVABLE,
            provider: 'stripe',
            providerAccountScope: 'default',
            currency: 'USD',
            ledgerAccountId: asset.id,
          },
        }),
      ).rejects.toThrow(/unique|Unique/i);
      await expect(
        db.ledgerAccountBinding.create({
          data: {
            organizationId,
            role: LedgerAccountBindingRole.PROVIDER_RECEIVABLE,
            provider: 'stripe',
            providerAccountScope: 'acct:X',
            currency: 'USD',
            ledgerAccountId: foreign.id,
          },
        }),
      ).rejects.toThrow();
      await expect(
        db.ledgerAccountBinding.create({
          data: {
            organizationId,
            role: LedgerAccountBindingRole.PROVIDER_RECEIVABLE,
            provider: 'stripe',
            providerAccountScope: 'acct:cad',
            currency: 'CAD',
            ledgerAccountId: asset.id,
          },
        }),
      ).rejects.toThrow(/currency|check/i);
      await expect(
        db.ledgerAccountBinding.create({
          data: {
            organizationId,
            role: LedgerAccountBindingRole.PROVIDER_RECEIVABLE,
            provider: 'stripe',
            providerAccountScope: 'acct:exp',
            currency: 'USD',
            ledgerAccountId: usdExpense.id,
          },
        }),
      ).rejects.toThrow(/ASSET|check/i);
      await expect(
        db.ledgerAccountBinding.create({
          data: {
            organizationId,
            role: LedgerAccountBindingRole.SETTLEMENT_PAYABLE,
            provider: 'stripe',
            providerAccountScope: 'acct:assetpay',
            currency: 'USD',
            ledgerAccountId: asset.id,
          },
        }),
      ).rejects.toThrow(/LIABILITY|check/i);
      await db.ledgerAccountBinding.create({
        data: {
          organizationId,
          role: LedgerAccountBindingRole.SETTLEMENT_PAYABLE,
          provider: 'stripe',
          providerAccountScope: 'default',
          currency: 'USD',
          ledgerAccountId: liability.id,
        },
      });
      await expect(
        db.ledgerAccountBinding.update({
          where: { id: receivable.id },
          data: { provider: 'moneris' },
        }),
      ).rejects.toThrow(/immutable/);
      await expect(
        db.ledgerAccountBinding.delete({ where: { id: receivable.id } }),
      ).rejects.toThrow(/immutable/);
      await expect(
        db.$executeRaw`DELETE FROM ledger_accounts WHERE id = ${asset.id}::uuid`,
      ).rejects.toThrow();
      await expect(accounts.archive(organizationId, asset.id, actor)).rejects.toMatchObject({
        code: 'LEDGER_ACCOUNT_BOUND',
      });
    });

    it('provisions one clearing pair under concurrent first use and replays the same ids', async () => {
      const organizationId = await registerOrg();
      const input = {
        organizationId,
        provider: 'stripe',
        providerAccountScope: 'acct:first',
        currency: 'USD',
      };
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          settle(() => db.$transaction((tx) => ensureProviderLedgerAccounts(tx, input))),
        ),
      );
      const first = results[0]!;
      expect(new Set(results.map((row) => row.providerReceivableAccountId)).size).toBe(1);
      expect(new Set(results.map((row) => row.settlementPayableAccountId)).size).toBe(1);
      const again = await ensureProviderLedgerAccounts(db, input);
      expect(again).toEqual(first);
      expect(
        await db.ledgerAccountBinding.count({
          where: { organizationId, provider: 'stripe', providerAccountScope: 'acct:first' },
        }),
      ).toBe(2);
      expect(
        await db.ledgerAccount.count({
          where: { organizationId, code: { startsWith: 'FUP.' } },
        }),
      ).toBe(2);
    });

    it('posts one capture journal for automatic capture and none for authorization', async () => {
      const organizationId = await registerOrg();
      const automatic = await authorizingPayment(organizationId);
      const piAuto = `pi_pled_auto_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, automatic.id, piAuto);
      await succeedPayment(organizationId, automatic.id, piAuto);
      const capture = await db.ledgerTransaction.findFirstOrThrow({
        where: { organizationId, transactionType: 'payment.capture', referenceId: automatic.id },
        include: { entries: { orderBy: { side: 'asc' } } },
      });
      expect(capture.referenceType).toBe('payment');
      expect(capture.description).toBe('Payment capture');
      expect(capture.metadata).toEqual({
        source: 'provider_execution',
        provider: 'stripe',
        paymentProviderExecutionId: expect.any(String),
      });
      expect(JSON.stringify(capture.metadata)).not.toContain('evt_');
      expect(capture.entries.map((entry) => entry.amount)).toEqual([10000n, 10000n]);
      expect(await journalCounts(organizationId)).toMatchObject({
        transactions: 1,
        entries: 2,
        captures: 1,
        refundJournals: 0,
      });
      expect(await clearingBalances(organizationId, 'stripe', 'default')).toEqual({
        receivable: { amount: '10000', currency: 'USD' },
        payable: { amount: '10000', currency: 'USD' },
      });

      const manual = await authorizingPayment(organizationId, 'MANUAL');
      const piManual = `pi_pled_man_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, manual.id, piManual);
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'payment_intent.amount_capturable_updated',
            stripePaymentIntentObject({
              id: piManual,
              status: 'requires_capture',
              capture_method: 'manual',
              amount_capturable: 10000,
              amount_received: 0,
            }),
            { id: `evt_fup_pled_auth_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      expect((await db.payment.findFirstOrThrow({ where: { id: manual.id } })).status).toBe(
        'AUTHORIZED',
      );
      expect(await journalCounts(organizationId)).toMatchObject({ captures: 1, transactions: 1 });

      await succeedPayment(organizationId, manual.id, piManual, 10000);
      expect((await db.payment.findFirstOrThrow({ where: { id: manual.id } })).status).toBe(
        'SUCCEEDED',
      );
      expect(await journalCounts(organizationId)).toMatchObject({ captures: 2, transactions: 2 });

      const partial = await authorizingPayment(organizationId);
      const piPartial = `pi_pled_part_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, partial.id, piPartial);
      await succeedPayment(organizationId, partial.id, piPartial, 6000);
      const captured = await db.payment.findFirstOrThrow({ where: { id: partial.id } });
      expect(captured.status).toBe('SUCCEEDED');
      expect(captured.capturedAmount).toBe(6000n);
      const partialJournal = await db.ledgerTransaction.findFirstOrThrow({
        where: { organizationId, transactionType: 'payment.capture', referenceId: partial.id },
        include: { entries: true },
      });
      expect(partialJournal.entries.map((entry) => entry.amount)).toEqual([6000n, 6000n]);
    });

    it('keeps one capture journal across duplicate and distinct success events', async () => {
      const organizationId = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_pled_dup_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      await succeedPayment(organizationId, payment.id, pi, 10000, `evt_fup_pled_a_${randomUUID()}`);
      await succeedPayment(organizationId, payment.id, pi, 10000, `evt_fup_pled_b_${randomUUID()}`);
      expect((await db.payment.findFirstOrThrow({ where: { id: payment.id } })).status).toBe(
        'SUCCEEDED',
      );
      expect(await journalCounts(organizationId)).toMatchObject({
        captures: 1,
        transactions: 1,
        entries: 2,
      });
    });

    it('posts refund reversals without creating a second capture journal', async () => {
      const organizationId = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_pled_ref_${randomUUID().slice(0, 8)}`;
      const paymentExecution = await bindPayment(organizationId, payment.id, pi);
      await succeedPayment(organizationId, payment.id, pi);

      const partial = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '2500',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const rePartial = `re_pled_p_${randomUUID().slice(0, 8)}`;
      await refundExecutions.create(
        {
          organizationId,
          refundId: partial.id,
          paymentProviderExecutionId: paymentExecution.id,
          providerRefundId: rePartial,
        },
        actor,
      );
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'refund.updated',
            stripeRefundObject({ id: rePartial, payment_intent: pi, amount: 2500 }),
            { id: `evt_fup_pled_rp_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      expect(await journalCounts(organizationId)).toMatchObject({
        captures: 1,
        refundJournals: 1,
        transactions: 2,
        entries: 4,
      });
      expect(await clearingBalances(organizationId, 'stripe', 'default')).toEqual({
        receivable: { amount: '7500', currency: 'USD' },
        payable: { amount: '7500', currency: 'USD' },
      });

      const remainder = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '7500',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const reFull = `re_pled_f_${randomUUID().slice(0, 8)}`;
      await refundExecutions.create(
        {
          organizationId,
          refundId: remainder.id,
          paymentProviderExecutionId: paymentExecution.id,
          providerRefundId: reFull,
        },
        actor,
      );
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'refund.updated',
            stripeRefundObject({ id: reFull, payment_intent: pi, amount: 7500 }),
            { id: `evt_fup_pled_rf_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      expect((await db.payment.findFirstOrThrow({ where: { id: payment.id } })).status).toBe(
        'REFUNDED',
      );
      expect(await journalCounts(organizationId)).toMatchObject({
        captures: 1,
        refundJournals: 2,
      });
      expect(await clearingBalances(organizationId, 'stripe', 'default')).toEqual({
        receivable: { amount: '0', currency: 'USD' },
        payable: { amount: '0', currency: 'USD' },
      });
    });

    it('posts two refund journals for 6000 + 4000 and ignores a failed refund', async () => {
      const organizationId = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_pled_two_${randomUUID().slice(0, 8)}`;
      const paymentExecution = await bindPayment(organizationId, payment.id, pi);
      await succeedPayment(organizationId, payment.id, pi);

      for (const amount of ['6000', '4000'] as const) {
        const refund = await refunds.create(
          {
            organizationId,
            paymentId: payment.id,
            amount,
            idempotencyKey: `ref-${randomUUID()}`,
          },
          actor,
        );
        const re = `re_pled_${amount}_${randomUUID().slice(0, 8)}`;
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
              stripeRefundObject({ id: re, payment_intent: pi, amount: Number(amount) }),
              { id: `evt_fup_pled_two_${amount}_${randomUUID().slice(0, 8)}` },
            ),
          ),
        );
      }
      const updated = await db.payment.findFirstOrThrow({ where: { id: payment.id } });
      expect(updated.refundedAmount).toBe(10000n);
      expect(updated.status).toBe('REFUNDED');
      expect(await journalCounts(organizationId)).toMatchObject({
        captures: 1,
        refundJournals: 2,
      });
      expect(await clearingBalances(organizationId, 'stripe', 'default')).toEqual({
        receivable: { amount: '0', currency: 'USD' },
        payable: { amount: '0', currency: 'USD' },
      });

      const failedPayment = await authorizingPayment(organizationId);
      const piFail = `pi_pled_failr_${randomUUID().slice(0, 8)}`;
      const failExecution = await bindPayment(organizationId, failedPayment.id, piFail);
      await succeedPayment(organizationId, failedPayment.id, piFail);
      const failedRefund = await refunds.create(
        {
          organizationId,
          paymentId: failedPayment.id,
          amount: '3000',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const reFail = `re_pled_fail_${randomUUID().slice(0, 8)}`;
      await refundExecutions.create(
        {
          organizationId,
          refundId: failedRefund.id,
          paymentProviderExecutionId: failExecution.id,
          providerRefundId: reFail,
        },
        actor,
      );
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent(
            'refund.failed',
            stripeRefundObject({
              id: reFail,
              payment_intent: piFail,
              amount: 3000,
              status: 'failed',
              failure_reason: 'expired_or_canceled_card',
            }),
            { id: `evt_fup_pled_rfail_${randomUUID().slice(0, 8)}` },
          ),
        ),
      );
      expect((await db.refund.findFirstOrThrow({ where: { id: failedRefund.id } })).status).toBe(
        'FAILED',
      );
      expect(
        await db.ledgerTransaction.count({
          where: { organizationId, transactionType: 'refund', referenceId: failedRefund.id },
        }),
      ).toBe(0);
    });

    it('replays the same refund journal for two succeeded observations', async () => {
      const organizationId = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_pled_rdup_${randomUUID().slice(0, 8)}`;
      const paymentExecution = await bindPayment(organizationId, payment.id, pi);
      await succeedPayment(organizationId, payment.id, pi);
      const refund = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '2500',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const re = `re_pled_rdup_${randomUUID().slice(0, 8)}`;
      await refundExecutions.create(
        {
          organizationId,
          refundId: refund.id,
          paymentProviderExecutionId: paymentExecution.id,
          providerRefundId: re,
        },
        actor,
      );
      const object = stripeRefundObject({ id: re, payment_intent: pi, amount: 2500 });
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent('refund.created', object, {
            id: `evt_fup_pled_rc_${randomUUID().slice(0, 8)}`,
          }),
        ),
      );
      await processor.process(
        await ingestAndClaim(
          stripeFinancialEvent('refund.updated', object, {
            id: `evt_fup_pled_ru_${randomUUID().slice(0, 8)}`,
          }),
        ),
      );
      expect(await journalCounts(organizationId)).toMatchObject({
        captures: 1,
        refundJournals: 1,
      });
      expect(
        (await db.payment.findFirstOrThrow({ where: { id: payment.id } })).refundedAmount,
      ).toBe(2500n);
    });

    it('converges ten concurrent capture ensures to one journal', async () => {
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
      await payments.beginAuthorization(organizationId, created.id, actor);
      await payments.markAuthorized(organizationId, created.id, 10000n, actor);
      const payment = await payments.markSucceeded(organizationId, created.id, 10000n, actor);
      const execution = await bindPayment(
        organizationId,
        payment.id,
        `pi_pled_conc_${randomUUID().slice(0, 8)}`,
      );
      await Promise.all(
        Array.from({ length: 10 }, () =>
          settle(() =>
            db.$transaction((tx) =>
              ensurePaymentCaptureLedgerPosting(tx, {
                organizationId,
                payment,
                paymentProviderExecution: execution,
              }),
            ),
          ),
        ),
      );
      expect(await journalCounts(organizationId)).toMatchObject({
        captures: 1,
        transactions: 1,
        entries: 2,
      });
    });

    it('serializes concurrent equivalent payment success events to one journal', async () => {
      const organizationId = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_pled_race_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      const first = await ingestAndClaim(
        stripeFinancialEvent('payment_intent.succeeded', stripePaymentIntentObject({ id: pi }), {
          id: `evt_fup_pled_race_a_${randomUUID().slice(0, 8)}`,
        }),
      );
      const second = await ingestAndClaim(
        stripeFinancialEvent('payment_intent.succeeded', stripePaymentIntentObject({ id: pi }), {
          id: `evt_fup_pled_race_b_${randomUUID().slice(0, 8)}`,
        }),
      );
      await Promise.all([processor.process(first), processor.process(second)]);
      expect((await db.payment.findFirstOrThrow({ where: { id: payment.id } })).status).toBe(
        'SUCCEEDED',
      );
      expect(await journalCounts(organizationId)).toMatchObject({
        captures: 1,
        transactions: 1,
        entries: 2,
      });
    });

    it('serializes concurrent refund.created and refund.updated to one refund journal', async () => {
      const organizationId = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_pled_rrace_${randomUUID().slice(0, 8)}`;
      const paymentExecution = await bindPayment(organizationId, payment.id, pi);
      await succeedPayment(organizationId, payment.id, pi);
      const refund = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '2500',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const re = `re_pled_rrace_${randomUUID().slice(0, 8)}`;
      await refundExecutions.create(
        {
          organizationId,
          refundId: refund.id,
          paymentProviderExecutionId: paymentExecution.id,
          providerRefundId: re,
        },
        actor,
      );
      const object = stripeRefundObject({ id: re, payment_intent: pi, amount: 2500 });
      const created = await ingestAndClaim(
        stripeFinancialEvent('refund.created', object, {
          id: `evt_fup_pled_rrace_c_${randomUUID().slice(0, 8)}`,
        }),
      );
      const updated = await ingestAndClaim(
        stripeFinancialEvent('refund.updated', object, {
          id: `evt_fup_pled_rrace_u_${randomUUID().slice(0, 8)}`,
        }),
      );
      await Promise.all([processor.process(created), processor.process(updated)]);
      expect((await db.refund.findFirstOrThrow({ where: { id: refund.id } })).status).toBe(
        'SUCCEEDED',
      );
      expect(
        (await db.payment.findFirstOrThrow({ where: { id: payment.id } })).refundedAmount,
      ).toBe(2500n);
      expect(await journalCounts(organizationId)).toMatchObject({
        captures: 1,
        refundJournals: 1,
      });
    });

    it('rolls back Payment mutation when ledger posting fails and converges on retry', async () => {
      const organizationId = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_pled_crash_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      const claimed = await ingestAndClaim(
        stripeFinancialEvent('payment_intent.succeeded', stripePaymentIntentObject({ id: pi }), {
          id: `evt_fup_pled_crash_${randomUUID().slice(0, 8)}`,
        }),
      );
      const beforeAudit = await db.auditLog.count({
        where: { organizationId, resourceId: payment.id, action: 'payment.succeeded' },
      });
      await expect(
        processStripeInboxEvent(db, claimed, {
          writeAudit,
          hooks: {
            ensurePaymentCaptureLedgerPosting: async () => {
              throw new Error('injected ledger failure');
            },
          },
        }),
      ).rejects.toThrow(/injected ledger failure/);
      expect((await db.payment.findFirstOrThrow({ where: { id: payment.id } })).status).toBe(
        'AUTHORIZING',
      );
      expect((await db.inboxEvent.findFirstOrThrow({ where: { id: claimed.id } })).status).toBe(
        'PROCESSING',
      );
      expect(
        await db.auditLog.count({
          where: { organizationId, resourceId: payment.id, action: 'payment.succeeded' },
        }),
      ).toBe(beforeAudit);
      expect(await journalCounts(organizationId)).toMatchObject({ transactions: 0, entries: 0 });

      const retry = await processor.process(claimed);
      expect(retry.outcome).toBe('APPLIED');
      expect((await db.payment.findFirstOrThrow({ where: { id: payment.id } })).status).toBe(
        'SUCCEEDED',
      );
      expect((await db.inboxEvent.findFirstOrThrow({ where: { id: claimed.id } })).status).toBe(
        'PROCESSED',
      );
      expect(await journalCounts(organizationId)).toMatchObject({
        captures: 1,
        transactions: 1,
        entries: 2,
      });
    });

    it('rolls back Refund success when ledger posting fails and converges on retry', async () => {
      const organizationId = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_pled_rcrash_${randomUUID().slice(0, 8)}`;
      const paymentExecution = await bindPayment(organizationId, payment.id, pi);
      await succeedPayment(organizationId, payment.id, pi);
      const refund = await refunds.create(
        {
          organizationId,
          paymentId: payment.id,
          amount: '2500',
          idempotencyKey: `ref-${randomUUID()}`,
        },
        actor,
      );
      const re = `re_pled_rcrash_${randomUUID().slice(0, 8)}`;
      await refundExecutions.create(
        {
          organizationId,
          refundId: refund.id,
          paymentProviderExecutionId: paymentExecution.id,
          providerRefundId: re,
        },
        actor,
      );
      const claimed = await ingestAndClaim(
        stripeFinancialEvent(
          'refund.updated',
          stripeRefundObject({ id: re, payment_intent: pi, amount: 2500 }),
          { id: `evt_fup_pled_rcrash_${randomUUID().slice(0, 8)}` },
        ),
      );
      await expect(
        processStripeInboxEvent(db, claimed, {
          writeAudit,
          hooks: {
            ensureRefundLedgerPosting: async () => {
              throw new Error('injected refund ledger failure');
            },
          },
        }),
      ).rejects.toThrow(/injected refund ledger failure/);
      expect((await db.refund.findFirstOrThrow({ where: { id: refund.id } })).status).toBe(
        'CREATED',
      );
      expect(
        (await db.payment.findFirstOrThrow({ where: { id: payment.id } })).refundedAmount,
      ).toBe(0n);
      expect((await db.inboxEvent.findFirstOrThrow({ where: { id: claimed.id } })).status).toBe(
        'PROCESSING',
      );
      expect(await journalCounts(organizationId)).toMatchObject({
        captures: 1,
        refundJournals: 0,
      });

      const retry = await processor.process(claimed);
      expect(retry.outcome).toBe('APPLIED');
      expect((await db.refund.findFirstOrThrow({ where: { id: refund.id } })).status).toBe(
        'SUCCEEDED',
      );
      expect(
        (await db.payment.findFirstOrThrow({ where: { id: payment.id } })).refundedAmount,
      ).toBe(2500n);
      expect(await journalCounts(organizationId)).toMatchObject({
        captures: 1,
        refundJournals: 1,
      });
    });

    it('rolls back Payment when a deferred unbalanced journal is injected', async () => {
      const organizationId = await registerOrg();
      const payment = await authorizingPayment(organizationId);
      const pi = `pi_pled_unbal_${randomUUID().slice(0, 8)}`;
      await bindPayment(organizationId, payment.id, pi);
      const claimed = await ingestAndClaim(
        stripeFinancialEvent('payment_intent.succeeded', stripePaymentIntentObject({ id: pi }), {
          id: `evt_fup_pled_unbal_${randomUUID().slice(0, 8)}`,
        }),
      );
      const asset = await createAccount(organizationId, LedgerAccountType.ASSET);
      await expect(
        processStripeInboxEvent(db, claimed, {
          writeAudit,
          hooks: {
            ensurePaymentCaptureLedgerPosting: async (tx) => {
              const rows = await tx.$queryRaw<Array<{ id: string }>>`
                INSERT INTO ledger_transactions (
                  id, organization_id, transaction_type, currency, metadata, posted_at, created_at
                )
                VALUES (
                  gen_random_uuid(), ${organizationId}::uuid, 'test.unbalanced', 'USD',
                  '{}'::jsonb, NOW(), NOW()
                )
                RETURNING id
              `;
              await tx.$executeRaw`
                INSERT INTO ledger_entries (
                  id, organization_id, ledger_transaction_id, ledger_account_id, side, amount, created_at
                )
                VALUES
                  (gen_random_uuid(), ${organizationId}::uuid, ${rows[0]!.id}::uuid, ${asset.id}::uuid, 'DEBIT', 10, NOW()),
                  (gen_random_uuid(), ${organizationId}::uuid, ${rows[0]!.id}::uuid, ${asset.id}::uuid, 'CREDIT', 7, NOW())
              `;
              return { posted: false };
            },
          },
        }),
      ).rejects.toThrow(/unbalanced/);
      expect((await db.payment.findFirstOrThrow({ where: { id: payment.id } })).status).toBe(
        'AUTHORIZING',
      );
      expect((await db.inboxEvent.findFirstOrThrow({ where: { id: claimed.id } })).status).toBe(
        'PROCESSING',
      );
      expect(await journalCounts(organizationId)).toMatchObject({ transactions: 0, entries: 0 });
    });

    it('isolates provider and account-scope clearing balances, including colliding opaque ids', async () => {
      const organizationId = await registerOrg();
      const opaque = `abc123_${randomUUID().slice(0, 6)}`;
      const cases = [
        { provider: 'stripe', scope: 'default' as const, reference: undefined },
        { provider: 'stripe', scope: 'acct:A', reference: 'A' },
        { provider: 'moneris', scope: 'default' as const, reference: undefined },
      ];
      for (const item of cases) {
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
        await payments.beginAuthorization(organizationId, created.id, actor);
        await payments.markAuthorized(organizationId, created.id, 10000n, actor);
        const payment = await payments.markSucceeded(organizationId, created.id, 10000n, actor);
        const execution = await bindPayment(
          organizationId,
          payment.id,
          opaque,
          item.reference,
          item.provider,
        );
        await db.$transaction((tx) =>
          ensurePaymentCaptureLedgerPosting(tx, {
            organizationId,
            payment,
            paymentProviderExecution: execution,
          }),
        );
      }
      expect(
        await db.ledgerAccountBinding.count({
          where: { organizationId, role: LedgerAccountBindingRole.PROVIDER_RECEIVABLE },
        }),
      ).toBe(3);
      expect(await clearingBalances(organizationId, 'stripe', 'default')).toEqual({
        receivable: { amount: '10000', currency: 'USD' },
        payable: { amount: '10000', currency: 'USD' },
      });
      expect(await clearingBalances(organizationId, 'stripe', 'acct:A')).toEqual({
        receivable: { amount: '10000', currency: 'USD' },
        payable: { amount: '10000', currency: 'USD' },
      });
      expect(await clearingBalances(organizationId, 'moneris', 'default')).toEqual({
        receivable: { amount: '10000', currency: 'USD' },
        payable: { amount: '10000', currency: 'USD' },
      });
      expect(
        await db.outboxEvent.count({
          where: { organizationId, eventType: { startsWith: 'ledger.' } },
        }),
      ).toBe(0);
    });
  },
);
