import {
  LedgerAccountBindingRole,
  LedgerAccountStatus,
  LedgerAccountType,
  Prisma,
  type LedgerAccount,
} from '@fraterunion-payments/database';
import {
  LEDGER_ERROR_CODES,
  LedgerError,
  canonicalizeLedgerAccountCode,
  canonicalizeLedgerAccountName,
  canonicalizeLedgerCurrency,
} from '@fraterunion-payments/ledger-core';
import { canonicalizeCurrencyCode } from '@fraterunion-payments/payment-core';
import {
  canonicalizeLedgerProvider,
  canonicalizeProviderAccountScope,
  requiredAccountTypeForRole,
  systemLedgerAccountCode,
  systemLedgerAccountName,
} from './system-accounts.js';
import {
  LEDGER_SYSTEM_ACCOUNT_ROLES,
  type EnsureProviderLedgerAccountsInput,
  type LedgerStore,
  type LedgerSystemAccountRole,
  type ProviderLedgerAccounts,
} from './types.js';

const LEDGER_BINDING_LOCK_CLASS = 87236403;

export async function ensureProviderLedgerAccounts(
  client: LedgerStore,
  input: EnsureProviderLedgerAccountsInput,
): Promise<ProviderLedgerAccounts> {
  const organizationId = input.organizationId;
  const provider = canonicalizeLedgerProvider(input.provider);
  const providerAccountScope = canonicalizeProviderAccountScope(input.providerAccountScope);
  const currency = canonicalizeCurrencyCode(canonicalizeLedgerCurrency(input.currency));
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${LEDGER_BINDING_LOCK_CLASS},
      hashtext(${`${organizationId}|${provider}|${providerAccountScope}|${currency}`})
    )
  `;
  const providerReceivableAccountId = await ensureRoleBinding(client, {
    organizationId,
    provider,
    providerAccountScope,
    currency,
    role: LEDGER_SYSTEM_ACCOUNT_ROLES.PROVIDER_RECEIVABLE,
  });
  const settlementPayableAccountId = await ensureRoleBinding(client, {
    organizationId,
    provider,
    providerAccountScope,
    currency,
    role: LEDGER_SYSTEM_ACCOUNT_ROLES.SETTLEMENT_PAYABLE,
  });
  return { providerReceivableAccountId, settlementPayableAccountId };
}

async function ensureRoleBinding(
  client: LedgerStore,
  input: {
    readonly organizationId: string;
    readonly provider: string;
    readonly providerAccountScope: string;
    readonly currency: string;
    readonly role: LedgerSystemAccountRole;
  },
): Promise<string> {
  const existing = await client.ledgerAccountBinding.findUnique({
    where: {
      organizationId_role_provider_providerAccountScope_currency: {
        organizationId: input.organizationId,
        role: input.role,
        provider: input.provider,
        providerAccountScope: input.providerAccountScope,
        currency: input.currency,
      },
    },
  });
  if (existing !== null) {
    await assertUsableBoundAccount(client, existing.ledgerAccountId, input);
    return existing.ledgerAccountId;
  }

  try {
    const account = await findOrCreateSystemAccount(client, input);
    await client.ledgerAccountBinding.create({
      data: {
        organizationId: input.organizationId,
        role: input.role,
        provider: input.provider,
        providerAccountScope: input.providerAccountScope,
        currency: input.currency,
        ledgerAccountId: account.id,
      },
    });
    return account.id;
  } catch (error) {
    if (!isBindingOrAccountUnique(error)) {
      throw error;
    }
    const replay = await client.ledgerAccountBinding.findUnique({
      where: {
        organizationId_role_provider_providerAccountScope_currency: {
          organizationId: input.organizationId,
          role: input.role,
          provider: input.provider,
          providerAccountScope: input.providerAccountScope,
          currency: input.currency,
        },
      },
    });
    if (replay !== null) {
      return replay.ledgerAccountId;
    }
    throw error;
  }
}

async function findOrCreateSystemAccount(
  client: LedgerStore,
  input: {
    readonly organizationId: string;
    readonly provider: string;
    readonly providerAccountScope: string;
    readonly currency: string;
    readonly role: LedgerSystemAccountRole;
  },
): Promise<LedgerAccount> {
  const code = canonicalizeLedgerAccountCode(systemLedgerAccountCode(input));
  const existing = await client.ledgerAccount.findUnique({
    where: {
      organizationId_code: { organizationId: input.organizationId, code },
    },
  });
  if (existing !== null) {
    assertBindingAccount(existing, input.role, input.currency);
    return existing;
  }
  try {
    return await client.ledgerAccount.create({
      data: {
        organizationId: input.organizationId,
        code,
        name: canonicalizeLedgerAccountName(systemLedgerAccountName(input)),
        type: requiredAccountTypeForRole(input.role),
        currency: input.currency,
        status: LedgerAccountStatus.ACTIVE,
      },
    });
  } catch (error) {
    if (!isLedgerAccountCodeUnique(error)) {
      throw error;
    }
    const replay = await client.ledgerAccount.findUnique({
      where: {
        organizationId_code: { organizationId: input.organizationId, code },
      },
    });
    if (replay === null) {
      throw error;
    }
    assertBindingAccount(replay, input.role, input.currency);
    return replay;
  }
}

async function assertUsableBoundAccount(
  client: LedgerStore,
  accountId: string,
  input: {
    readonly organizationId: string;
    readonly currency: string;
    readonly role: LedgerSystemAccountRole;
  },
): Promise<void> {
  const account = await client.ledgerAccount.findFirst({
    where: { id: accountId, organizationId: input.organizationId },
  });
  if (account === null) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_ACCOUNT_NOT_FOUND,
      'Bound ledger account was not found.',
    );
  }
  assertBindingAccount(account, input.role, input.currency);
}

function assertBindingAccount(
  account: LedgerAccount,
  role: LedgerSystemAccountRole,
  currency: string,
): void {
  if (account.status === LedgerAccountStatus.ARCHIVED) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_ACCOUNT_ARCHIVED,
      'Archived ledger accounts cannot receive new postings.',
    );
  }
  if (account.currency !== currency) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_BINDING_CURRENCY_MISMATCH,
      'Ledger binding currency must match the account currency.',
    );
  }
  const required = requiredAccountTypeForRole(role);
  if (account.type !== required) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_BINDING_ROLE_MISMATCH,
      `${role} must bind a ${required} account.`,
    );
  }
}

export async function assertLedgerAccountUnbound(
  client: LedgerStore,
  organizationId: string,
  accountId: string,
): Promise<void> {
  const binding = await client.ledgerAccountBinding.findFirst({
    where: { organizationId, ledgerAccountId: accountId },
  });
  if (binding !== null) {
    throw new LedgerError(
      LEDGER_ERROR_CODES.LEDGER_ACCOUNT_BOUND,
      'System-bound ledger accounts cannot be archived.',
    );
  }
}

export function isBindingOrAccountUnique(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = `${JSON.stringify(error.meta ?? {})} ${error.message}`.toLowerCase();
  return (
    target.includes('ledger_account_bindings') ||
    target.includes('role_scope') ||
    target.includes('ledger_accounts_org_code') ||
    target.includes('organization_id_code')
  );
}

function isLedgerAccountCodeUnique(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = `${JSON.stringify(error.meta ?? {})} ${error.message}`.toLowerCase();
  return target.includes('ledger_accounts_org_code') || target.includes('organization_id_code');
}

export { LedgerAccountBindingRole, LedgerAccountType };
