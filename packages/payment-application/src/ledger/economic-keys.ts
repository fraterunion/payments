export function paymentCaptureLedgerIdempotencyKey(paymentId: string): string {
  return `ledger:payment:capture:${paymentId}`;
}

export function refundLedgerIdempotencyKey(refundId: string): string {
  return `ledger:refund:${refundId}`;
}

export const CAPTURED_PAYMENT_STATES = new Set(['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED']);

export function shouldPostPaymentCaptureJournal(input: {
  readonly status: string;
  readonly capturedAmount: bigint;
}): boolean {
  return input.capturedAmount > 0n && CAPTURED_PAYMENT_STATES.has(input.status);
}

export function shouldPostRefundJournal(status: string): boolean {
  return status === 'SUCCEEDED';
}

/** Capture journals use canonical capturedAmount, never requestedAmount. */
export function selectPaymentCaptureJournalAmount(payment: {
  readonly capturedAmount: bigint;
}): bigint {
  return payment.capturedAmount;
}

/** Refund journals use the Refund's own amount, not a Payment delta. */
export function selectRefundJournalAmount(refund: { readonly amount: bigint }): bigint {
  return refund.amount;
}

export function paymentCaptureLedgerMetadata(input: {
  readonly provider: string;
  readonly paymentProviderExecutionId: string;
}): Record<string, unknown> {
  return {
    source: 'provider_execution',
    provider: input.provider,
    paymentProviderExecutionId: input.paymentProviderExecutionId,
  };
}

export function refundLedgerMetadata(input: {
  readonly provider: string;
  readonly paymentProviderExecutionId: string;
  readonly refundProviderExecutionId: string;
}): Record<string, unknown> {
  return {
    source: 'provider_execution',
    provider: input.provider,
    paymentProviderExecutionId: input.paymentProviderExecutionId,
    refundProviderExecutionId: input.refundProviderExecutionId,
  };
}
