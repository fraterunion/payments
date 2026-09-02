import { DOMAIN_ERROR_CODES, PaymentDomainError } from '../errors/errors.js';

/**
 * Abstract provider boundary identifiers. Not stored on the payment
 * aggregate.
 */
export type ProviderPaymentReference = {
  readonly provider: string;
  readonly providerPaymentId: string;
};

export type ProviderCustomerReference = {
  readonly provider: string;
  readonly providerCustomerId: string;
};

function requireToken(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PaymentDomainError(DOMAIN_ERROR_CODES.INVALID_IDENTIFIER, `${label} is required.`);
  }
  return trimmed;
}

export function createProviderPaymentReference(input: {
  readonly provider: string;
  readonly providerPaymentId: string;
}): ProviderPaymentReference {
  return Object.freeze({
    provider: requireToken(input.provider, 'provider'),
    providerPaymentId: requireToken(input.providerPaymentId, 'providerPaymentId'),
  });
}

export function createProviderCustomerReference(input: {
  readonly provider: string;
  readonly providerCustomerId: string;
}): ProviderCustomerReference {
  return Object.freeze({
    provider: requireToken(input.provider, 'provider'),
    providerCustomerId: requireToken(input.providerCustomerId, 'providerCustomerId'),
  });
}
