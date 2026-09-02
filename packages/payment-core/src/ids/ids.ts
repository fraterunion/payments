import { DOMAIN_ERROR_CODES, PaymentDomainError } from '../errors/errors.js';

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export type PaymentId = Brand<string, 'PaymentId'>;
export type RefundId = Brand<string, 'RefundId'>;
export type OrganizationId = Brand<string, 'OrganizationId'>;
export type CustomerId = Brand<string, 'CustomerId'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(value: string, label: string): string {
  const trimmed = value.trim();
  if (!UUID_PATTERN.test(trimmed)) {
    throw new PaymentDomainError(DOMAIN_ERROR_CODES.INVALID_IDENTIFIER, `${label} must be a UUID.`);
  }
  return trimmed.toLowerCase();
}

export function asPaymentId(value: string): PaymentId {
  return asUuid(value, 'PaymentId') as PaymentId;
}

export function asRefundId(value: string): RefundId {
  return asUuid(value, 'RefundId') as RefundId;
}

export function asOrganizationId(value: string): OrganizationId {
  return asUuid(value, 'OrganizationId') as OrganizationId;
}

export function asCustomerId(value: string): CustomerId {
  return asUuid(value, 'CustomerId') as CustomerId;
}
