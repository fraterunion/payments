import type {
  ProviderAccountReference,
  ProviderIdempotencyKey,
} from '@fraterunion-payments/provider-contracts';

/**
 * Canonical FUP connection readiness. Not Stripe account status strings.
 */
export const PROVIDER_ACCOUNT_STATUSES = {
  PENDING: 'PENDING',
  REQUIRES_ACTION: 'REQUIRES_ACTION',
  ACTIVE: 'ACTIVE',
  RESTRICTED: 'RESTRICTED',
  DISCONNECTED: 'DISCONNECTED',
} as const;

export type ProviderAccountStatus =
  (typeof PROVIDER_ACCOUNT_STATUSES)[keyof typeof PROVIDER_ACCOUNT_STATUSES];

export type ProviderAccountObservation = {
  readonly providerAccountReference: ProviderAccountReference;
  readonly status: ProviderAccountStatus;
  readonly paymentsEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly requirementsDue: boolean;
  readonly observedAt: Date;
};

export type StripeHostedOnboardingLink = {
  readonly url: string;
  readonly expiresAt?: Date;
};

export type StripeConnectAccountCreateInput = {
  readonly displayName: string;
  readonly country: string;
  readonly defaultCurrency: string;
  readonly idempotencyKey: ProviderIdempotencyKey;
};

export type StripeConnectAccountRetrieveInput = {
  readonly providerAccountReference: ProviderAccountReference;
};

export type StripeConnectOnboardingLinkInput = {
  readonly providerAccountReference: ProviderAccountReference;
  readonly returnUrl: string;
  readonly refreshUrl: string;
};

export type StripeConnectOperations = {
  createConnectedAccount(
    input: StripeConnectAccountCreateInput,
  ): Promise<ProviderAccountObservation>;
  retrieveConnectedAccount(
    input: StripeConnectAccountRetrieveInput,
  ): Promise<ProviderAccountObservation>;
  createHostedOnboardingLink(
    input: StripeConnectOnboardingLinkInput,
  ): Promise<StripeHostedOnboardingLink>;
};
