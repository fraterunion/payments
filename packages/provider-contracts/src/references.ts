import type { PaymentMethodType } from '@fraterunion-payments/payment-core';
import { PAYMENT_METHOD_TYPES } from '@fraterunion-payments/payment-core';
import { ProviderContractError, ProviderMismatchError, PROVIDER_ERROR_CODES } from './errors.js';
import { asPaymentProviderCode, type PaymentProviderCode } from './provider-code.js';
import { requireBoundedText } from './text.js';

export const PROVIDER_RESOURCE_ID_MAX_LENGTH = 255;

export type ProviderOwnedReference = {
  readonly provider: PaymentProviderCode;
  readonly id: string;
};

export type ProviderPaymentReference = ProviderOwnedReference;
export type ProviderCustomerReference = ProviderOwnedReference;
export type ProviderRefundReference = ProviderOwnedReference;
export type ProviderAccountReference = ProviderOwnedReference;

export type ProviderPaymentMethodReference = {
  readonly provider: PaymentProviderCode;
  readonly id: string;
  readonly type: PaymentMethodType;
};

const METHOD_TYPE_SET: ReadonlySet<string> = new Set(Object.values(PAYMENT_METHOD_TYPES));

function asProviderResourceId(value: string, label: string): string {
  return requireBoundedText(
    value,
    label,
    PROVIDER_RESOURCE_ID_MAX_LENGTH,
    PROVIDER_ERROR_CODES.INVALID_PROVIDER_REFERENCE,
  );
}

function createOwnedReference(
  input: { readonly provider: string; readonly id: string },
  idLabel: string,
): ProviderOwnedReference {
  return Object.freeze({
    provider: asPaymentProviderCode(input.provider),
    id: asProviderResourceId(input.id, idLabel),
  });
}

export function createProviderPaymentReference(input: {
  readonly provider: string;
  readonly id: string;
}): ProviderPaymentReference {
  return createOwnedReference(input, 'provider payment id');
}

export function createProviderCustomerReference(input: {
  readonly provider: string;
  readonly id: string;
}): ProviderCustomerReference {
  return createOwnedReference(input, 'provider customer id');
}

export function createProviderRefundReference(input: {
  readonly provider: string;
  readonly id: string;
}): ProviderRefundReference {
  return createOwnedReference(input, 'provider refund id');
}

export function createProviderAccountReference(input: {
  readonly provider: string;
  readonly id: string;
}): ProviderAccountReference {
  return createOwnedReference(input, 'provider account id');
}

export function createProviderPaymentMethodReference(input: {
  readonly provider: string;
  readonly id: string;
  readonly type: PaymentMethodType;
}): ProviderPaymentMethodReference {
  if (!METHOD_TYPE_SET.has(input.type)) {
    throw new ProviderContractError('Payment method type is not recognized.', {
      code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_REFERENCE,
    });
  }
  return Object.freeze({
    provider: asPaymentProviderCode(input.provider),
    id: asProviderResourceId(input.id, 'provider payment method id'),
    type: input.type,
  });
}

export function assertProviderOwns(
  provider: PaymentProviderCode,
  reference: { readonly provider: PaymentProviderCode },
): void {
  if (reference.provider !== provider) {
    throw new ProviderMismatchError(provider, reference.provider);
  }
}
