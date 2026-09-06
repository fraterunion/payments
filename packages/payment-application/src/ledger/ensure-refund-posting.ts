import type {
  Payment,
  PaymentProviderExecution,
  Refund,
  RefundProviderExecution,
} from '@fraterunion-payments/database';
import { LEDGER_SIDES, LEDGER_ERROR_CODES, LedgerError } from '@fraterunion-payments/ledger-core';
import {
  ensureProviderLedgerAccounts,
  postLedgerTransaction,
  type LedgerStore,
  type PostedLedgerTransaction,
} from '@fraterunion-payments/ledger-application';
import {
  refundLedgerIdempotencyKey,
  refundLedgerMetadata,
  selectRefundJournalAmount,
  shouldPostRefundJournal,
} from './economic-keys.js';

export type EnsureRefundPostingResult =
  | { readonly posted: false; readonly transaction?: undefined }
  | { readonly posted: true; readonly transaction: PostedLedgerTransaction };

export async function ensureRefundLedgerPosting(
  tx: LedgerStore,
  input: {
    readonly organizationId: string;
    readonly payment: Payment;
    readonly refund: Refund;
    readonly paymentProviderExecution: PaymentProviderExecution;
    readonly refundProviderExecution: RefundProviderExecution;
  },
): Promise<EnsureRefundPostingResult> {
  const { payment, refund, paymentProviderExecution, refundProviderExecution } = input;
  if (refund.paymentId !== payment.id || refund.organizationId !== input.organizationId) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_CROSS_TENANT_ACCOUNT,
      'Refund does not belong to this Payment organization.',
    );
  }
  if (
    refundProviderExecution.refundId !== refund.id ||
    refundProviderExecution.paymentProviderExecutionId !== paymentProviderExecution.id ||
    paymentProviderExecution.paymentId !== payment.id
  ) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_REFERENCE,
      'Refund provider execution does not match the Payment execution.',
    );
  }
  if (
    paymentProviderExecution.provider !== refundProviderExecution.provider ||
    paymentProviderExecution.providerAccountScope !== refundProviderExecution.providerAccountScope
  ) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_REFERENCE,
      'Refund execution provider scope does not match the Payment execution.',
    );
  }
  if (refund.currency !== payment.currency) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_CURRENCY_MISMATCH,
      'Refund currency must match the Payment currency.',
    );
  }
  if (!shouldPostRefundJournal(refund.status)) {
    return { posted: false };
  }
  if (refund.amount <= 0n) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_AMOUNT,
      'A succeeded Refund cannot post a zero or negative journal.',
    );
  }

  const accounts = await ensureProviderLedgerAccounts(tx, {
    organizationId: input.organizationId,
    provider: refundProviderExecution.provider,
    providerAccountScope: refundProviderExecution.providerAccountScope,
    currency: refund.currency,
  });
  const transaction = await postLedgerTransaction(tx, {
    organizationId: input.organizationId,
    idempotencyKey: refundLedgerIdempotencyKey(refund.id),
    transactionType: 'refund',
    currency: refund.currency,
    description: 'Refund',
    reference: { type: 'refund', id: refund.id },
    metadata: refundLedgerMetadata({
      provider: refundProviderExecution.provider,
      paymentProviderExecutionId: paymentProviderExecution.id,
      refundProviderExecutionId: refundProviderExecution.id,
    }),
    entries: [
      {
        accountId: accounts.settlementPayableAccountId,
        side: LEDGER_SIDES.DEBIT,
        amount: selectRefundJournalAmount(refund),
      },
      {
        accountId: accounts.providerReceivableAccountId,
        side: LEDGER_SIDES.CREDIT,
        amount: selectRefundJournalAmount(refund),
      },
    ],
  });
  return { posted: true, transaction };
}
