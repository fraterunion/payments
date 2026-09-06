import { describe, expect, it } from 'vitest';
import {
  paymentCaptureLedgerIdempotencyKey,
  paymentCaptureLedgerMetadata,
  refundLedgerIdempotencyKey,
  refundLedgerMetadata,
  selectPaymentCaptureJournalAmount,
  selectRefundJournalAmount,
  shouldPostPaymentCaptureJournal,
  shouldPostRefundJournal,
} from './economic-keys.js';

describe('payment/refund ledger economic identity', () => {
  it('uses deterministic keys that never include event ids', () => {
    const paymentId = '11111111-1111-7111-8111-111111111111';
    const refundId = '22222222-2222-7222-8222-222222222222';
    expect(paymentCaptureLedgerIdempotencyKey(paymentId)).toBe(
      `ledger:payment:capture:${paymentId}`,
    );
    expect(refundLedgerIdempotencyKey(refundId)).toBe(`ledger:refund:${refundId}`);
    expect(paymentCaptureLedgerIdempotencyKey(paymentId)).not.toContain('evt_');
    expect(refundLedgerIdempotencyKey(refundId)).not.toContain('evt_');
  });

  it('posts capture only for captured-family states with a positive captured amount', () => {
    expect(shouldPostPaymentCaptureJournal({ status: 'SUCCEEDED', capturedAmount: 10000n })).toBe(
      true,
    );
    expect(
      shouldPostPaymentCaptureJournal({ status: 'PARTIALLY_REFUNDED', capturedAmount: 6000n }),
    ).toBe(true);
    expect(shouldPostPaymentCaptureJournal({ status: 'REFUNDED', capturedAmount: 10000n })).toBe(
      true,
    );
    expect(shouldPostPaymentCaptureJournal({ status: 'AUTHORIZED', capturedAmount: 0n })).toBe(
      false,
    );
    expect(shouldPostPaymentCaptureJournal({ status: 'FAILED', capturedAmount: 0n })).toBe(false);
    expect(shouldPostPaymentCaptureJournal({ status: 'CANCELED', capturedAmount: 0n })).toBe(false);
    expect(shouldPostPaymentCaptureJournal({ status: 'SUCCEEDED', capturedAmount: 0n })).toBe(
      false,
    );
  });

  it('posts refund journals only for SUCCEEDED refunds', () => {
    expect(shouldPostRefundJournal('SUCCEEDED')).toBe(true);
    expect(shouldPostRefundJournal('CREATED')).toBe(false);
    expect(shouldPostRefundJournal('PROCESSING')).toBe(false);
    expect(shouldPostRefundJournal('FAILED')).toBe(false);
  });

  it('selects captured amount and refund amount, never requested or payment deltas', () => {
    expect(selectPaymentCaptureJournalAmount({ capturedAmount: 6000n })).toBe(6000n);
    expect(selectRefundJournalAmount({ amount: 2500n })).toBe(2500n);
  });

  it('builds deterministic metadata without webhook or provider object ids', () => {
    const payment = paymentCaptureLedgerMetadata({
      provider: 'stripe',
      paymentProviderExecutionId: 'exec-1',
    });
    expect(payment).toEqual({
      source: 'provider_execution',
      provider: 'stripe',
      paymentProviderExecutionId: 'exec-1',
    });
    expect(JSON.stringify(payment)).not.toContain('evt_');
    expect(JSON.stringify(payment)).not.toContain('pi_');
    expect(
      refundLedgerMetadata({
        provider: 'moneris',
        paymentProviderExecutionId: 'pex',
        refundProviderExecutionId: 'rex',
      }),
    ).toEqual({
      source: 'provider_execution',
      provider: 'moneris',
      paymentProviderExecutionId: 'pex',
      refundProviderExecutionId: 'rex',
    });
  });
});
