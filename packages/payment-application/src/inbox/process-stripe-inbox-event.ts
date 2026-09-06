import type {
  InboxEvent,
  Payment as PaymentRow,
  Prisma,
  PrismaClient,
  Refund as RefundRow,
} from '@fraterunion-payments/database';
import {
  applyPaymentProviderObservation,
  applyRefund,
  applyRefundProviderObservation,
  asOrganizationId,
  asPaymentId,
  asRefundId,
  asCustomerId,
  CAPTURE_METHODS,
  createMoney,
  createPaymentFailure,
  PAYMENT_STATES,
  REFUND_STATES,
  type Payment as DomainPayment,
  type Refund as DomainRefund,
} from '@fraterunion-payments/payment-core';
import {
  normalizeStripeFinancialEvent,
  STRIPE_PROVIDER_CODE,
  StripeWebhookNormalizeError,
} from '@fraterunion-payments/provider-stripe';
import { isLedgerError } from '@fraterunion-payments/ledger-core';
import { isLedgerApplicationError } from '@fraterunion-payments/ledger-application';
import {
  InboxService,
  INBOX_PROCESSING_OUTCOMES,
  RetryableEventError,
  TerminalEventError,
  type EventWriteClient,
  type InboxProcessingOutcome,
} from '@fraterunion-payments/events';
import { ensurePaymentCaptureLedgerPosting } from '../ledger/ensure-payment-capture-posting.js';
import { ensureRefundLedgerPosting } from '../ledger/ensure-refund-posting.js';

export type StripeInboxAuditWrite = (
  client: EventWriteClient,
  input: {
    readonly organizationId: string;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly metadata: Record<string, unknown>;
  },
) => Promise<void>;

export type ProcessStripeInboxResult = {
  readonly outcome: InboxProcessingOutcome;
  readonly event: InboxEvent;
};

export type ProcessStripeInboxHooks = {
  readonly ensurePaymentCaptureLedgerPosting?: typeof ensurePaymentCaptureLedgerPosting;
  readonly ensureRefundLedgerPosting?: typeof ensureRefundLedgerPosting;
};

const inbox = new InboxService();

function accountScopeFromEventAccount(accountId: string | undefined): {
  readonly providerAccountReference: string | undefined;
  readonly providerAccountScope: string;
} {
  if (accountId === undefined) {
    return { providerAccountReference: undefined, providerAccountScope: 'default' };
  }
  return {
    providerAccountReference: accountId,
    providerAccountScope: `acct:${accountId}`,
  };
}

function toDomainPayment(row: PaymentRow): DomainPayment {
  const currency = row.currency;
  return Object.freeze({
    id: asPaymentId(row.id),
    organizationId: asOrganizationId(row.organizationId),
    status: row.status,
    captureMethod:
      row.captureMethod === 'AUTOMATIC' ? CAPTURE_METHODS.AUTOMATIC : CAPTURE_METHODS.MANUAL,
    requestedAmount: createMoney(row.requestedAmount, currency),
    authorizedAmount: createMoney(row.authorizedAmount, currency),
    capturedAmount: createMoney(row.capturedAmount, currency),
    refundedAmount: createMoney(row.refundedAmount, currency),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.customerId !== null ? { customerId: asCustomerId(row.customerId) } : {}),
  });
}

function toPaymentUpdate(payment: DomainPayment): Prisma.PaymentUpdateInput {
  const failed = payment.status === PAYMENT_STATES.FAILED;
  const failure = payment.failure;
  return {
    status: payment.status,
    authorizedAmount: payment.authorizedAmount.amount,
    capturedAmount: payment.capturedAmount.amount,
    refundedAmount: payment.refundedAmount.amount,
    failureCategory: failed && failure !== undefined ? failure.category : null,
    failureCode: failed && failure?.code !== undefined ? failure.code : null,
    failureMessage: failed && failure !== undefined ? failure.message : null,
    failureRetryable: failed && failure !== undefined ? failure.retryable : null,
  };
}

function toDomainRefund(row: RefundRow): DomainRefund {
  return Object.freeze({
    id: asRefundId(row.id),
    paymentId: asPaymentId(row.paymentId),
    organizationId: asOrganizationId(row.organizationId),
    amount: createMoney(row.amount, row.currency),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.reason !== null ? { reason: row.reason } : {}),
    ...(row.status === REFUND_STATES.FAILED &&
    row.failureCategory !== null &&
    row.failureMessage !== null &&
    row.failureRetryable !== null
      ? {
          failure: createPaymentFailure({
            category: row.failureCategory,
            message: row.failureMessage,
            retryable: row.failureRetryable,
            ...(row.failureCode !== null ? { code: row.failureCode } : {}),
          }),
        }
      : {}),
  });
}

function toRefundUpdate(refund: DomainRefund): Prisma.RefundUpdateInput {
  const failed = refund.status === REFUND_STATES.FAILED;
  const failure = refund.failure;
  return {
    status: refund.status,
    failureCategory: failed && failure !== undefined ? failure.category : null,
    failureCode: failed && failure?.code !== undefined ? failure.code : null,
    failureMessage: failed && failure !== undefined ? failure.message : null,
    failureRetryable: failed && failure !== undefined ? failure.retryable : null,
  };
}

function paymentAuditAction(status: DomainPayment['status']): string | undefined {
  switch (status) {
    case PAYMENT_STATES.REQUIRES_PAYMENT_METHOD:
      return 'payment.requires_payment_method';
    case PAYMENT_STATES.REQUIRES_ACTION:
      return 'payment.requires_action';
    case PAYMENT_STATES.AUTHORIZING:
      return 'payment.authorization_started';
    case PAYMENT_STATES.AUTHORIZED:
      return 'payment.authorized';
    case PAYMENT_STATES.CAPTURING:
      return 'payment.capture_started';
    case PAYMENT_STATES.SUCCEEDED:
      return 'payment.succeeded';
    case PAYMENT_STATES.FAILED:
      return 'payment.failed';
    case PAYMENT_STATES.CANCELED:
      return 'payment.canceled';
    case PAYMENT_STATES.PARTIALLY_REFUNDED:
      return 'payment.partially_refunded';
    case PAYMENT_STATES.REFUNDED:
      return 'payment.refunded';
    default:
      return undefined;
  }
}

function webhookAuditMetadata(
  event: InboxEvent,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    source: 'provider_webhook',
    provider: STRIPE_PROVIDER_CODE,
    eventId: event.externalEventId,
    ...extra,
  };
}

async function lockInbox(tx: EventWriteClient, eventId: string): Promise<InboxEvent> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM inbox_events WHERE id = ${eventId}::uuid FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new TerminalEventError('Inbox event was not found.', 'INBOX_NOT_RECEIVED');
  }
  return tx.inboxEvent.findUniqueOrThrow({ where: { id: eventId } });
}

async function lockPayment(
  tx: EventWriteClient,
  organizationId: string,
  paymentId: string,
): Promise<PaymentRow> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM payments
    WHERE id = ${paymentId}::uuid AND organization_id = ${organizationId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new TerminalEventError('Payment was not found for provider execution.', 'ANOMALY');
  }
  return tx.payment.findFirstOrThrow({ where: { id: paymentId, organizationId } });
}

async function lockRefund(
  tx: EventWriteClient,
  organizationId: string,
  paymentId: string,
  refundId: string,
): Promise<RefundRow> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM refunds
    WHERE id = ${refundId}::uuid
      AND organization_id = ${organizationId}::uuid
      AND payment_id = ${paymentId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new TerminalEventError('Refund was not found for provider execution.', 'ANOMALY');
  }
  return tx.refund.findFirstOrThrow({ where: { id: refundId, organizationId } });
}

async function resolvePaymentExecution(
  tx: EventWriteClient,
  providerPaymentId: string,
  expectedScope: string,
) {
  const execution = await tx.paymentProviderExecution.findFirst({
    where: {
      provider: STRIPE_PROVIDER_CODE,
      providerAccountScope: expectedScope,
      providerPaymentId,
    },
  });
  if (execution !== null) {
    return execution;
  }
  const otherAccount = await tx.paymentProviderExecution.findFirst({
    where: { provider: STRIPE_PROVIDER_CODE, providerPaymentId },
  });
  if (otherAccount !== null) {
    throw new TerminalEventError(
      'Provider execution account scope does not match the Stripe event account.',
      'PROVIDER_EXECUTION_ACCOUNT_MISMATCH',
    );
  }
  throw new RetryableEventError(
    'No payment provider execution exists for this Stripe PaymentIntent.',
    'UNRESOLVED_EXTERNAL_REFERENCE',
  );
}

async function resolveRefundExecution(
  tx: EventWriteClient,
  providerRefundId: string,
  expectedScope: string,
) {
  const execution = await tx.refundProviderExecution.findFirst({
    where: {
      provider: STRIPE_PROVIDER_CODE,
      providerAccountScope: expectedScope,
      providerRefundId,
    },
  });
  if (execution !== null) {
    return execution;
  }
  const otherAccount = await tx.refundProviderExecution.findFirst({
    where: { provider: STRIPE_PROVIDER_CODE, providerRefundId },
  });
  if (otherAccount !== null) {
    throw new TerminalEventError(
      'Refund provider execution account scope does not match the Stripe event account.',
      'PROVIDER_EXECUTION_ACCOUNT_MISMATCH',
    );
  }
  throw new RetryableEventError(
    'No refund provider execution exists for this Stripe Refund.',
    'UNRESOLVED_EXTERNAL_REFERENCE',
  );
}

async function assertInboxTenant(
  tx: EventWriteClient,
  event: InboxEvent,
  organizationId: string,
): Promise<void> {
  if (event.organizationId !== null && event.organizationId !== organizationId) {
    throw new TerminalEventError(
      'Inbox tenant does not match the provider execution.',
      'PROVIDER_EXECUTION_ACCOUNT_MISMATCH',
    );
  }
  if (event.organizationId === null) {
    await inbox.assignOrganizationIfUnresolved(tx, event.id, organizationId);
  }
}

/**
 * Apply one claimed Stripe InboxEvent. Financial mutation, audit, and
 * Inbox PROCESSED commit together. Lock order: InboxEvent, Payment, Refund.
 */
export async function processStripeInboxEvent(
  db: PrismaClient,
  event: InboxEvent,
  options: {
    readonly writeAudit: StripeInboxAuditWrite;
    readonly now?: Date;
    readonly hooks?: ProcessStripeInboxHooks;
  },
): Promise<ProcessStripeInboxResult> {
  const now = options.now ?? new Date();
  const postCapture =
    options.hooks?.ensurePaymentCaptureLedgerPosting ?? ensurePaymentCaptureLedgerPosting;
  const postRefund = options.hooks?.ensureRefundLedgerPosting ?? ensureRefundLedgerPosting;
  return db.$transaction(async (tx) => {
    const lockedInbox = await lockInbox(tx, event.id);
    if (lockedInbox.status === 'PROCESSED') {
      return {
        outcome:
          (lockedInbox.processingOutcome as InboxProcessingOutcome | null) ??
          INBOX_PROCESSING_OUTCOMES.NOOP_ALREADY_CURRENT,
        event: lockedInbox,
      };
    }
    if (lockedInbox.status !== 'PROCESSING') {
      throw new TerminalEventError(
        'Inbox event is not claimed for processing.',
        'INBOX_NOT_RECEIVED',
      );
    }

    let normalized;
    try {
      normalized = normalizeStripeFinancialEvent(lockedInbox.payload);
    } catch (error) {
      if (error instanceof StripeWebhookNormalizeError) {
        throw new TerminalEventError(error.message, error.code);
      }
      throw error;
    }

    if (normalized.kind === 'ignored') {
      const processed = await inbox.markProcessed(
        tx,
        lockedInbox.id,
        now,
        INBOX_PROCESSING_OUTCOMES.IGNORED_EVENT_TYPE,
      );
      return { outcome: INBOX_PROCESSING_OUTCOMES.IGNORED_EVENT_TYPE, event: processed };
    }

    const eventAccountId = normalized.providerAccount?.id;
    const expectedScope = accountScopeFromEventAccount(eventAccountId);

    if (normalized.kind === 'payment') {
      const execution = await resolvePaymentExecution(
        tx,
        normalized.providerPayment.id,
        expectedScope.providerAccountScope,
      );
      await assertInboxTenant(tx, lockedInbox, execution.organizationId);

      const paymentRow = await lockPayment(tx, execution.organizationId, execution.paymentId);
      if (paymentRow.currency !== normalized.requestedAmount.currency) {
        throw new TerminalEventError(
          'Provider observation currency does not match the canonical Payment.',
          'CURRENCY_MISMATCH',
        );
      }

      const applied = applyPaymentProviderObservation(toDomainPayment(paymentRow), {
        state: normalized.observation.state,
        observedAt: normalized.observation.observedAt,
        ...(normalized.observation.authorizedAmount !== undefined
          ? { authorizedAmount: normalized.observation.authorizedAmount }
          : {}),
        ...(normalized.observation.capturedAmount !== undefined
          ? { capturedAmount: normalized.observation.capturedAmount }
          : {}),
        ...(normalized.observation.failure !== undefined
          ? { failure: normalized.observation.failure }
          : {}),
      });

      if (applied.kind === 'ANOMALY') {
        throw new TerminalEventError(
          `Payment observation could not be applied (${applied.reason}).`,
          applied.reason,
        );
      }

      let currentPayment = paymentRow;
      if (applied.kind === 'APPLIED') {
        currentPayment = await tx.payment.update({
          where: { id: paymentRow.id },
          data: toPaymentUpdate(applied.payment),
        });
        const action = paymentAuditAction(applied.toStatus);
        if (action !== undefined) {
          await options.writeAudit(tx, {
            organizationId: currentPayment.organizationId,
            action,
            resourceType: 'payment',
            resourceId: currentPayment.id,
            metadata: webhookAuditMetadata(lockedInbox, {
              paymentId: currentPayment.id,
              providerExecutionId: execution.id,
              oldStatus: applied.fromStatus,
              newStatus: applied.toStatus,
              requestedAmount: currentPayment.requestedAmount.toString(10),
              authorizedAmount: currentPayment.authorizedAmount.toString(10),
              capturedAmount: currentPayment.capturedAmount.toString(10),
              refundedAmount: currentPayment.refundedAmount.toString(10),
            }),
          });
        }
      }

      await runLedgerPosting(() =>
        postCapture(tx, {
          organizationId: execution.organizationId,
          payment: currentPayment,
          paymentProviderExecution: execution,
        }),
      );

      const outcome =
        applied.kind === 'APPLIED'
          ? INBOX_PROCESSING_OUTCOMES.APPLIED
          : applied.kind === 'NOOP_STALE'
            ? INBOX_PROCESSING_OUTCOMES.NOOP_STALE
            : INBOX_PROCESSING_OUTCOMES.NOOP_ALREADY_CURRENT;
      const processed = await inbox.markProcessed(tx, lockedInbox.id, now, outcome);
      return { outcome, event: processed };
    }

    const refundExecution = await resolveRefundExecution(
      tx,
      normalized.providerRefund.id,
      expectedScope.providerAccountScope,
    );
    await assertInboxTenant(tx, lockedInbox, refundExecution.organizationId);

    const paymentExecution = await tx.paymentProviderExecution.findFirstOrThrow({
      where: { id: refundExecution.paymentProviderExecutionId },
    });
    if (
      normalized.providerPayment !== undefined &&
      normalized.providerPayment.id !== paymentExecution.providerPaymentId
    ) {
      throw new TerminalEventError(
        'Refund snapshot payment intent does not match the bound payment execution.',
        'PROVIDER_PAYMENT_REFERENCE_MISMATCH',
      );
    }

    const paymentRow = await lockPayment(
      tx,
      refundExecution.organizationId,
      refundExecution.paymentId,
    );
    const refundRow = await lockRefund(
      tx,
      refundExecution.organizationId,
      refundExecution.paymentId,
      refundExecution.refundId,
    );

    const refundApplied = applyRefundProviderObservation(toDomainRefund(refundRow), {
      state: normalized.state,
      amount: normalized.amount,
      observedAt: normalized.observation.observedAt,
      ...(normalized.observation.failure !== undefined
        ? { failure: normalized.observation.failure }
        : {}),
    });

    if (refundApplied.kind === 'ANOMALY') {
      throw new TerminalEventError(
        `Refund observation could not be applied (${refundApplied.reason}).`,
        refundApplied.reason,
      );
    }

    let currentRefund = refundRow;
    let currentPayment = paymentRow;
    if (refundApplied.kind === 'APPLIED') {
      let nextPayment = toDomainPayment(paymentRow);
      const refundBecameSucceeded =
        refundApplied.fromStatus !== REFUND_STATES.SUCCEEDED &&
        refundApplied.toStatus === REFUND_STATES.SUCCEEDED;
      if (refundBecameSucceeded) {
        nextPayment = applyRefund(nextPayment, refundApplied.refund.amount);
      }

      currentRefund = await tx.refund.update({
        where: { id: refundRow.id },
        data: toRefundUpdate(refundApplied.refund),
      });
      currentPayment = refundBecameSucceeded
        ? await tx.payment.update({
            where: { id: paymentRow.id },
            data: toPaymentUpdate(nextPayment),
          })
        : paymentRow;

      const refundAction =
        refundApplied.toStatus === REFUND_STATES.PROCESSING
          ? 'refund.processing_started'
          : refundApplied.toStatus === REFUND_STATES.SUCCEEDED
            ? 'refund.succeeded'
            : refundApplied.toStatus === REFUND_STATES.FAILED
              ? 'refund.failed'
              : undefined;
      if (refundAction !== undefined) {
        await options.writeAudit(tx, {
          organizationId: currentRefund.organizationId,
          action: refundAction,
          resourceType: 'refund',
          resourceId: currentRefund.id,
          metadata: webhookAuditMetadata(lockedInbox, {
            refundId: currentRefund.id,
            paymentId: currentPayment.id,
            providerExecutionId: refundExecution.id,
            oldStatus: refundApplied.fromStatus,
            newStatus: refundApplied.toStatus,
            amount: currentRefund.amount.toString(10),
          }),
        });
      }
      if (refundBecameSucceeded) {
        const paymentAction = paymentAuditAction(nextPayment.status);
        if (paymentAction !== undefined) {
          await options.writeAudit(tx, {
            organizationId: currentPayment.organizationId,
            action: paymentAction,
            resourceType: 'payment',
            resourceId: currentPayment.id,
            metadata: webhookAuditMetadata(lockedInbox, {
              paymentId: currentPayment.id,
              refundId: currentRefund.id,
              oldStatus: paymentRow.status,
              newStatus: nextPayment.status,
              refundedAmount: currentPayment.refundedAmount.toString(10),
            }),
          });
        }
      }
    }

    await runLedgerPosting(() =>
      postCapture(tx, {
        organizationId: refundExecution.organizationId,
        payment: currentPayment,
        paymentProviderExecution: paymentExecution,
      }),
    );
    await runLedgerPosting(() =>
      postRefund(tx, {
        organizationId: refundExecution.organizationId,
        payment: currentPayment,
        refund: currentRefund,
        paymentProviderExecution: paymentExecution,
        refundProviderExecution: refundExecution,
      }),
    );

    const outcome =
      refundApplied.kind === 'APPLIED'
        ? INBOX_PROCESSING_OUTCOMES.APPLIED
        : refundApplied.kind === 'NOOP_STALE'
          ? INBOX_PROCESSING_OUTCOMES.NOOP_STALE
          : INBOX_PROCESSING_OUTCOMES.NOOP_ALREADY_CURRENT;
    const processed = await inbox.markProcessed(tx, lockedInbox.id, now, outcome);
    return { outcome, event: processed };
  });
}

async function runLedgerPosting(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    throw mapLedgerProcessingError(error);
  }
}

function mapLedgerProcessingError(error: unknown): never {
  if (isLedgerApplicationError(error)) {
    if (
      error.code === 'LEDGER_CONCURRENCY_CONFLICT' ||
      error.code === 'IDEMPOTENCY_OPERATION_IN_PROGRESS'
    ) {
      throw new RetryableEventError(error.message, error.code);
    }
    throw new TerminalEventError(error.message, error.code);
  }
  if (isLedgerError(error)) {
    throw new TerminalEventError(error.message, error.code);
  }
  throw error;
}
