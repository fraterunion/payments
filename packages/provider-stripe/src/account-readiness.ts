import {
  ProviderContractError,
  PROVIDER_ERROR_CODES,
} from '@fraterunion-payments/provider-contracts';
import { stripeAccountReference } from './account-id.js';
import {
  PROVIDER_ACCOUNT_STATUSES,
  type ProviderAccountObservation,
  type ProviderAccountStatus,
} from './connect-types.js';

const CAPABILITY_STATUSES = new Set(['active', 'pending', 'restricted', 'unsupported']);
const DUE_STATUSES = new Set(['currently_due', 'past_due']);

export type StripeCapabilityStatusSource = {
  readonly status?: string;
};

export type StripeConnectedAccountSnapshot = {
  readonly id: string;
  readonly closed?: boolean;
  readonly configuration?: {
    readonly merchant?: {
      readonly applied?: boolean;
      readonly capabilities?: {
        readonly card_payments?: StripeCapabilityStatusSource;
        readonly stripe_balance?: {
          readonly payouts?: StripeCapabilityStatusSource;
        };
      };
    };
  };
  readonly requirements?: {
    readonly entries?: ReadonlyArray<{
      readonly minimum_deadline?: { readonly status?: string };
    }>;
    readonly summary?: {
      readonly minimum_deadline?: { readonly status?: string };
    };
  };
};

function capabilityStatus(source: StripeCapabilityStatusSource | undefined): string | undefined {
  if (source?.status === undefined) {
    return undefined;
  }
  if (!CAPABILITY_STATUSES.has(source.status)) {
    throw new ProviderContractError('Stripe returned an unrecognized capability status.', {
      code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
    });
  }
  return source.status;
}

function isDueStatus(status: string | undefined): boolean {
  return status !== undefined && DUE_STATUSES.has(status);
}

/**
 * Maps Accounts v2 retrieve fields onto canonical FUP readiness.
 *
 * Fields consumed (and not persisted beyond booleans/status):
 * - `closed`
 * - `configuration.merchant.capabilities.card_payments.status`
 * - `configuration.merchant.capabilities.stripe_balance.payouts.status`
 * - `requirements.summary.minimum_deadline.status`
 * - `requirements.entries[].minimum_deadline.status`
 *
 * `ACTIVE` requires card payments and payouts both `active`.
 * `requirementsDue` is currently_due or past_due only — not eventually_due.
 */
export function normalizeStripeAccountObservation(
  account: StripeConnectedAccountSnapshot,
  observedAt: Date,
): ProviderAccountObservation {
  const paymentsStatus = capabilityStatus(
    account.configuration?.merchant?.capabilities?.card_payments,
  );
  const payoutsStatus = capabilityStatus(
    account.configuration?.merchant?.capabilities?.stripe_balance?.payouts,
  );
  const paymentsEnabled = paymentsStatus === 'active';
  const payoutsEnabled = payoutsStatus === 'active';
  const requirementsDue =
    isDueStatus(account.requirements?.summary?.minimum_deadline?.status) ||
    (account.requirements?.entries ?? []).some((entry) =>
      isDueStatus(entry.minimum_deadline?.status),
    );

  const status = resolveStatus({
    closed: account.closed === true,
    paymentsEnabled,
    payoutsEnabled,
    paymentsStatus,
    payoutsStatus,
    requirementsDue,
  });

  return {
    providerAccountReference: stripeAccountReference(account.id),
    status,
    paymentsEnabled,
    payoutsEnabled,
    requirementsDue,
    observedAt,
  };
}

function resolveStatus(input: {
  readonly closed: boolean;
  readonly paymentsEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly paymentsStatus: string | undefined;
  readonly payoutsStatus: string | undefined;
  readonly requirementsDue: boolean;
}): ProviderAccountStatus {
  if (input.closed) {
    return PROVIDER_ACCOUNT_STATUSES.DISCONNECTED;
  }
  if (input.paymentsEnabled && input.payoutsEnabled) {
    return PROVIDER_ACCOUNT_STATUSES.ACTIVE;
  }
  if (input.requirementsDue) {
    return PROVIDER_ACCOUNT_STATUSES.REQUIRES_ACTION;
  }
  if (input.paymentsStatus === 'restricted' || input.payoutsStatus === 'restricted') {
    return PROVIDER_ACCOUNT_STATUSES.RESTRICTED;
  }
  return PROVIDER_ACCOUNT_STATUSES.PENDING;
}
