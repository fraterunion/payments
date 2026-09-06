import { createHash } from 'node:crypto';
import { LEDGER_ERROR_CODES, LedgerError } from '@fraterunion-payments/ledger-core';
import { LEDGER_SYSTEM_ACCOUNT_ROLES, type LedgerSystemAccountRole } from './types.js';

const PROVIDER_PATTERN = /^[a-z0-9_-]+$/;
const SCOPE_PATTERN = /^(default|acct:.+)$/;

export function canonicalizeLedgerProvider(value: string): string {
  const provider = value.trim().toLowerCase();
  if (!PROVIDER_PATTERN.test(provider)) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_REFERENCE,
      'Ledger provider must be a lowercase token.',
    );
  }
  return provider;
}

export function canonicalizeProviderAccountScope(value: string): string {
  const scope = value.trim();
  if (!SCOPE_PATTERN.test(scope)) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_INVALID_REFERENCE,
      'Ledger providerAccountScope must be default or acct:<id>.',
    );
  }
  return scope;
}

/**
 * Deterministic system account code:
 * `FUP.{PR|SP}.{PROVIDER}.{CURRENCY}.{scopeHash12}`
 *
 * `scopeHash12` is the first 12 uppercase hex characters of SHA-256 of the
 * exact `providerAccountScope` string. It never includes raw provider
 * account ids.
 */
export function systemLedgerAccountCode(input: {
  readonly role: LedgerSystemAccountRole;
  readonly provider: string;
  readonly providerAccountScope: string;
  readonly currency: string;
}): string {
  const provider = canonicalizeLedgerProvider(input.provider).toUpperCase();
  const scope = canonicalizeProviderAccountScope(input.providerAccountScope);
  const roleToken = input.role === LEDGER_SYSTEM_ACCOUNT_ROLES.PROVIDER_RECEIVABLE ? 'PR' : 'SP';
  const scopeHash = createHash('sha256')
    .update(scope, 'utf8')
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return `FUP.${roleToken}.${provider}.${input.currency}.${scopeHash}`;
}

export function systemLedgerAccountName(input: {
  readonly role: LedgerSystemAccountRole;
  readonly provider: string;
}): string {
  const label = titleizeProvider(canonicalizeLedgerProvider(input.provider));
  return input.role === LEDGER_SYSTEM_ACCOUNT_ROLES.PROVIDER_RECEIVABLE
    ? `${label} Provider Receivable`
    : `${label} Settlement Payable`;
}

export function requiredAccountTypeForRole(role: LedgerSystemAccountRole): 'ASSET' | 'LIABILITY' {
  return role === LEDGER_SYSTEM_ACCOUNT_ROLES.PROVIDER_RECEIVABLE ? 'ASSET' : 'LIABILITY';
}

function titleizeProvider(provider: string): string {
  return provider
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
