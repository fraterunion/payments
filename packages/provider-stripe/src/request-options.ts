import {
  assertProviderOwns,
  type PaymentProviderCode,
  type ProviderAccountReference,
  type ProviderIdempotencyKey,
} from '@fraterunion-payments/provider-contracts';

export type StripeRequestOptions = {
  readonly idempotencyKey?: string;
  readonly stripeAccount?: string;
};

export function createStripeRequestOptions(input: {
  readonly provider: PaymentProviderCode;
  readonly idempotencyKey?: ProviderIdempotencyKey | undefined;
  readonly providerAccount?: ProviderAccountReference | undefined;
}): StripeRequestOptions {
  if (input.providerAccount !== undefined) {
    assertProviderOwns(input.provider, input.providerAccount);
  }

  return {
    ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.providerAccount !== undefined ? { stripeAccount: input.providerAccount.id } : {}),
  };
}
