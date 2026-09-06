import { describe, expect, it } from 'vitest';
import { LEDGER_SYSTEM_ACCOUNT_ROLES } from './types.js';
import {
  canonicalizeLedgerProvider,
  canonicalizeProviderAccountScope,
  requiredAccountTypeForRole,
  systemLedgerAccountCode,
  systemLedgerAccountName,
} from './system-accounts.js';

describe('system ledger account identity', () => {
  it('builds a deterministic bounded code without raw account ids', () => {
    const left = systemLedgerAccountCode({
      role: LEDGER_SYSTEM_ACCOUNT_ROLES.PROVIDER_RECEIVABLE,
      provider: 'stripe',
      providerAccountScope: 'acct:opaque',
      currency: 'USD',
    });
    const right = systemLedgerAccountCode({
      role: LEDGER_SYSTEM_ACCOUNT_ROLES.PROVIDER_RECEIVABLE,
      provider: 'STRIPE',
      providerAccountScope: 'acct:opaque',
      currency: 'USD',
    });
    expect(left).toBe(right);
    expect(left.startsWith('FUP.PR.STRIPE.USD.')).toBe(true);
    expect(left.includes('opaque')).toBe(false);
    expect(left.length).toBeLessThanOrEqual(64);
  });

  it('separates provider, scope, currency, and role', () => {
    const stripeDefault = systemLedgerAccountCode({
      role: LEDGER_SYSTEM_ACCOUNT_ROLES.PROVIDER_RECEIVABLE,
      provider: 'stripe',
      providerAccountScope: 'default',
      currency: 'USD',
    });
    const stripeConnected = systemLedgerAccountCode({
      role: LEDGER_SYSTEM_ACCOUNT_ROLES.PROVIDER_RECEIVABLE,
      provider: 'stripe',
      providerAccountScope: 'acct:A',
      currency: 'USD',
    });
    const moneris = systemLedgerAccountCode({
      role: LEDGER_SYSTEM_ACCOUNT_ROLES.PROVIDER_RECEIVABLE,
      provider: 'moneris',
      providerAccountScope: 'default',
      currency: 'USD',
    });
    const payable = systemLedgerAccountCode({
      role: LEDGER_SYSTEM_ACCOUNT_ROLES.SETTLEMENT_PAYABLE,
      provider: 'stripe',
      providerAccountScope: 'default',
      currency: 'USD',
    });
    expect(new Set([stripeDefault, stripeConnected, moneris, payable]).size).toBe(4);
  });

  it('maps roles to account types and display names without Stripe enums', () => {
    expect(requiredAccountTypeForRole(LEDGER_SYSTEM_ACCOUNT_ROLES.PROVIDER_RECEIVABLE)).toBe(
      'ASSET',
    );
    expect(requiredAccountTypeForRole(LEDGER_SYSTEM_ACCOUNT_ROLES.SETTLEMENT_PAYABLE)).toBe(
      'LIABILITY',
    );
    expect(
      systemLedgerAccountName({
        role: LEDGER_SYSTEM_ACCOUNT_ROLES.PROVIDER_RECEIVABLE,
        provider: 'moneris',
      }),
    ).toBe('Moneris Provider Receivable');
  });

  it('rejects illegal provider or scope tokens', () => {
    expect(() => canonicalizeLedgerProvider('Stripe Account')).toThrow(/lowercase/);
    expect(() => canonicalizeProviderAccountScope('acct_123')).toThrow(/default or acct/);
  });
});
