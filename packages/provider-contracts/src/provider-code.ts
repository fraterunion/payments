import { ProviderContractError, PROVIDER_ERROR_CODES } from './errors.js';

declare const brand: unique symbol;

export type PaymentProviderCode = string & { readonly [brand]: 'PaymentProviderCode' };

export const PROVIDER_CODE_MAX_LENGTH = 32;
export const PROVIDER_CODE_PATTERN = /^[a-z0-9_-]+$/;

/**
 * Internal routing identity. Not a display name and not a closed enum.
 */
export function asPaymentProviderCode(value: string): PaymentProviderCode {
  if (typeof value !== 'string') {
    throw new ProviderContractError('Provider code must be a string.', {
      code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_CODE,
    });
  }
  const canonical = value.trim().toLowerCase();
  if (canonical.length === 0) {
    throw new ProviderContractError('Provider code is required.', {
      code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_CODE,
    });
  }
  if (canonical.length > PROVIDER_CODE_MAX_LENGTH) {
    throw new ProviderContractError(
      `Provider code must be at most ${PROVIDER_CODE_MAX_LENGTH} characters.`,
      { code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_CODE },
    );
  }
  if (!PROVIDER_CODE_PATTERN.test(canonical)) {
    throw new ProviderContractError('Provider code must use lowercase [a-z0-9_-] only.', {
      code: PROVIDER_ERROR_CODES.INVALID_PROVIDER_CODE,
    });
  }
  return canonical as PaymentProviderCode;
}

export function isPaymentProviderCode(value: string): value is PaymentProviderCode {
  try {
    asPaymentProviderCode(value);
    return true;
  } catch {
    return false;
  }
}
