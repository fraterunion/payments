import { describe, expect, it } from 'vitest';
import { canonicalizeLedgerPosting, ledgerPostingFingerprintPayload } from './fingerprint.js';

describe('ledger posting fingerprint', () => {
  it('is independent of entry order', () => {
    const left = canonicalizeLedgerPosting({
      organizationId: 'org-1',
      transactionType: 'Test.Posting',
      currency: 'usd',
      description: '  Sale  ',
      metadata: { b: 2, a: 1 },
      entries: [
        { accountId: 'cash', side: 'DEBIT', amount: 1000n },
        { accountId: 'rev', side: 'CREDIT', amount: 1000n },
      ],
    });
    const right = canonicalizeLedgerPosting({
      organizationId: 'org-1',
      transactionType: 'test.posting',
      currency: 'USD',
      description: 'Sale',
      metadata: { a: 1, b: 2 },
      entries: [
        { accountId: 'rev', side: 'CREDIT', amount: 1000n },
        { accountId: 'cash', side: 'DEBIT', amount: 1000n },
      ],
    });
    expect(ledgerPostingFingerprintPayload(left)).toEqual(ledgerPostingFingerprintPayload(right));
  });

  it('changes when amount, side, account, type, or reference changes', () => {
    const base = canonicalizeLedgerPosting({
      organizationId: 'org-1',
      transactionType: 'test.posting',
      currency: 'USD',
      reference: { type: 'test', id: 'ref-1' },
      entries: [
        { accountId: 'cash', side: 'DEBIT', amount: 1000n },
        { accountId: 'rev', side: 'CREDIT', amount: 1000n },
      ],
    });
    const differentAmount = canonicalizeLedgerPosting({
      organizationId: 'org-1',
      transactionType: 'test.posting',
      currency: 'USD',
      reference: { type: 'test', id: 'ref-1' },
      entries: [
        { accountId: 'cash', side: 'DEBIT', amount: 2000n },
        { accountId: 'rev', side: 'CREDIT', amount: 2000n },
      ],
    });
    expect(ledgerPostingFingerprintPayload(base)).not.toEqual(
      ledgerPostingFingerprintPayload(differentAmount),
    );
  });

  it('rejects invalid currency shape', () => {
    expect(() =>
      canonicalizeLedgerPosting({
        organizationId: 'org-1',
        transactionType: 'test.posting',
        currency: 'US',
        entries: [
          { accountId: 'cash', side: 'DEBIT', amount: 1n },
          { accountId: 'rev', side: 'CREDIT', amount: 1n },
        ],
      }),
    ).toThrow(/three ASCII letters/);
  });
});
