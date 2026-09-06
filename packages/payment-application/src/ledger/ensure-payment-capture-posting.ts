import type { Payment, PaymentProviderExecution } from '@fraterunion-payments/database';
import { LEDGER_SIDES, LEDGER_ERROR_CODES, LedgerError } from '@fraterunion-payments/ledger-core';
import {
  ensureProviderLedgerAccounts,
  postLedgerTransaction,
  type LedgerStore,
  type PostedLedgerTransaction,
} from '@fraterunion-payments/ledger-application';
import {
  paymentCaptureLedgerIdempotencyKey,
  paymentCaptureLedgerMetadata,
  selectPaymentCaptureJournalAmount,
  shouldPostPaymentCaptureJournal,
} from './economic-keys.js';

export type EnsurePaymentCaptureResult =
  | { readonly posted: false; readonly transaction?: undefined }
  | { readonly posted: true; readonly transaction: PostedLedgerTransaction };

export async function ensurePaymentCaptureLedgerPosting(
  tx: LedgerStore,
  input: {
    readonly organizationId: string;
    readonly payment: Payment;
    readonly paymentProviderExecution: PaymentProviderExecution;
  },
): Promise<EnsurePaymentCaptureResult> {
  const { payment, paymentProviderExecution } = input;
  if (paymentProviderExecution.paymentId !== payment.id) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_REFERENCE,
      'Payment provider execution does not belong to this Payment.',
    );
  }
  if (payment.organizationId !== input.organizationId) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_CROSS_TENANT_ACCOUNT,
      'Payment does not belong to the posting organization.',
    );
  }
  if (
    payment.capturedAmount <= 0n &&
    (payment.status === 'SUCCEEDED' ||
      payment.status === 'PARTIALLY_REFUNDED' ||
      payment.status === 'REFUNDED')
  ) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_PAYMENT_INVALID_CAPTURE_AMOUNT,
      'A captured Payment cannot post a zero or negative capture journal.',
    );
  }
  if (
    !shouldPostPaymentCaptureJournal({
      status: payment.status,
      capturedAmount: payment.capturedAmount,
    })
  ) {
    return { posted: false };
  }

  const accounts = await ensureProviderLedgerAccounts(tx, {
    organizationId: input.organizationId,
    provider: paymentProviderExecution.provider,
    providerAccountScope: paymentProviderExecution.providerAccountScope,
    currency: payment.currency,
  });
  const transaction = await postLedgerTransaction(tx, {
    organizationId: input.organizationId,
    idempotencyKey: paymentCaptureLedgerIdempotencyKey(payment.id),
    transactionType: 'payment.capture',
    currency: payment.currency,
    description: 'Payment capture',
    reference: { type: 'payment', id: payment.id },
    metadata: paymentCaptureLedgerMetadata({
      provider: paymentProviderExecution.provider,
      paymentProviderExecutionId: paymentProviderExecution.id,
    }),
    entries: [
      {
        accountId: accounts.providerReceivableAccountId,
        side: LEDGER_SIDES.DEBIT,
        amount: selectPaymentCaptureJournalAmount(payment),
      },
      {
        accountId: accounts.settlementPayableAccountId,
        side: LEDGER_SIDES.CREDIT,
        amount: selectPaymentCaptureJournalAmount(payment),
      },
    ],
  });
  return { posted: true, transaction };
}
