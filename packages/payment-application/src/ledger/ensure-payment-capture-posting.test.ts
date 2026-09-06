import { LEDGER_ERROR_CODES } from '@fraterunion-payments/ledger-core';
import { describe, expect, it } from 'vitest';
import { ensurePaymentCaptureLedgerPosting } from './ensure-payment-capture-posting.js';
import type { LedgerStore } from '@fraterunion-payments/ledger-application';

describe('ensurePaymentCaptureLedgerPosting', () => {
  it('rejects a captured-family Payment with a zero captured amount', async () => {
    await expect(
      ensurePaymentCaptureLedgerPosting({} as LedgerStore, {
        organizationId: 'org-1',
        payment: {
          id: 'pay-1',
          organizationId: 'org-1',
          status: 'SUCCEEDED',
          capturedAmount: 0n,
          currency: 'USD',
        } as never,
        paymentProviderExecution: {
          id: 'pex-1',
          paymentId: 'pay-1',
          provider: 'stripe',
          providerAccountScope: 'default',
        } as never,
      }),
    ).rejects.toMatchObject({
      code: LEDGER_ERROR_CODES.LEDGER_PAYMENT_INVALID_CAPTURE_AMOUNT,
    });
  });
});
