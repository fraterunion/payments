import {
  asPaymentProviderCode,
  createProviderAccountReference,
  createProviderCustomerReference,
} from '@fraterunion-payments/provider-contracts';
import { DEFAULT_PROVIDER_ACCOUNT_SCOPE, PROVIDER_ACCOUNT_SCOPE_PREFIX } from './customer.types';

export function normalizeProviderAccountScope(providerAccountReference?: string): {
  readonly providerAccountReference: string | undefined;
  readonly providerAccountScope: string;
} {
  if (providerAccountReference === undefined) {
    return {
      providerAccountReference: undefined,
      providerAccountScope: DEFAULT_PROVIDER_ACCOUNT_SCOPE,
    };
  }
  const reference = createProviderAccountReference({
    provider: 'example',
    id: providerAccountReference,
  }).id;
  return {
    providerAccountReference: reference,
    providerAccountScope: `${PROVIDER_ACCOUNT_SCOPE_PREFIX}${reference}`,
  };
}

export function normalizeProviderMappingIdentity(input: {
  readonly provider: string;
  readonly providerCustomerId: string;
  readonly providerAccountReference?: string;
}): {
  readonly provider: string;
  readonly providerCustomerId: string;
  readonly providerAccountReference: string | undefined;
  readonly providerAccountScope: string;
} {
  const provider = asPaymentProviderCode(input.provider);
  const providerCustomerId = createProviderCustomerReference({
    provider,
    id: input.providerCustomerId,
  }).id;
  const account = normalizeProviderAccountScope(input.providerAccountReference);
  if (account.providerAccountReference !== undefined) {
    createProviderAccountReference({
      provider,
      id: account.providerAccountReference,
    });
  }
  return {
    provider,
    providerCustomerId,
    providerAccountReference: account.providerAccountReference,
    providerAccountScope: account.providerAccountScope,
  };
}
