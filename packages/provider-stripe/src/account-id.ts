import {
  ProviderContractError,
  PROVIDER_ERROR_CODES,
  createProviderAccountReference,
  type ProviderAccountReference,
} from '@fraterunion-payments/provider-contracts';
import { STRIPE_PROVIDER_CODE } from './constants.js';

/**
 * Stripe connected-account IDs are opaque. Canonical layers must not
 * derive business meaning from the `acct_` prefix. This check is
 * Stripe-boundary ownership validation only.
 */
const STRIPE_ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9]+$/;

export function asStripeAccountId(value: string): string {
  const reference = createProviderAccountReference({
    provider: STRIPE_PROVIDER_CODE,
    id: value,
  });
  if (!STRIPE_ACCOUNT_ID_PATTERN.test(reference.id)) {
    throw new ProviderContractError(
      'Stripe account id is not a valid connected-account identity.',
      {
        code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_REFERENCE,
      },
    );
  }
  return reference.id;
}

export function stripeAccountReference(id: string): ProviderAccountReference {
  return createProviderAccountReference({
    provider: STRIPE_PROVIDER_CODE,
    id: asStripeAccountId(id),
  });
}
