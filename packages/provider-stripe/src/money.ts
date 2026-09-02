import { createMoney, type CurrencyCode, type Money } from '@fraterunion-payments/payment-core';
import {
  ProviderContractError,
  PROVIDER_ERROR_CODES,
} from '@fraterunion-payments/provider-contracts';

/**
 * Stripe PaymentIntent/Refund `amount` is a JavaScript number.
 * Canonical Money uses bigint minor units, which can exceed
 * Number.MAX_SAFE_INTEGER. Convert only inside this proven range.
 */
export const STRIPE_MAX_SAFE_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);

export function toStripeAmount(amount: bigint): number {
  if (typeof amount !== 'bigint') {
    throw new ProviderContractError('Amount must be a bigint integer in minor units.', {
      code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
    });
  }
  if (amount <= 0n) {
    throw new ProviderContractError('Amount must be greater than zero.', {
      code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
    });
  }
  if (amount > STRIPE_MAX_SAFE_AMOUNT) {
    throw new ProviderContractError(
      'Amount exceeds the safe integer range Stripe can represent without precision loss.',
      { code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT },
    );
  }
  return Number(amount);
}

export function fromStripeAmount(value: number): bigint {
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new ProviderContractError('Provider amount is not a safe integer.', {
      code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
    });
  }
  if (value < 0) {
    throw new ProviderContractError('Provider amount cannot be negative.', {
      code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
    });
  }
  return BigInt(value);
}

export function toStripeCurrency(currency: CurrencyCode): string {
  return currency.toLowerCase();
}

export function moneyFromStripe(amount: number, currency: string): Money {
  try {
    return createMoney(fromStripeAmount(amount), currency);
  } catch (error) {
    if (error instanceof ProviderContractError) {
      throw error;
    }
    throw new ProviderContractError('Provider amount or currency could not be normalized.', {
      code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT,
    });
  }
}
