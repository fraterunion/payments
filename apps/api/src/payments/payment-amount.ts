import { InvalidPaymentAmountException } from './payment.exceptions';

const MINOR_UNIT_PATTERN = /^[1-9][0-9]{0,18}$/;

/**
 * Parses API amount transport: integer minor units encoded as a base-10
 * decimal string. Rejects floats, decimal points, signs, and leading zeros.
 */
export function parsePositiveMinorUnitAmount(value: string, label = 'amount'): bigint {
  if (typeof value !== 'string') {
    throw new InvalidPaymentAmountException(
      `${label} must be a decimal string of integer minor units.`,
    );
  }
  const trimmed = value.trim();
  if (!MINOR_UNIT_PATTERN.test(trimmed)) {
    throw new InvalidPaymentAmountException(
      `${label} must be a positive integer minor-unit decimal string (for example "12500").`,
    );
  }
  return BigInt(trimmed);
}

export function serializeMinorUnitAmount(amount: bigint): string {
  if (typeof amount !== 'bigint') {
    throw new InvalidPaymentAmountException('Monetary amounts must be bigint minor units.');
  }
  if (amount < 0n) {
    throw new InvalidPaymentAmountException('Monetary amounts cannot be negative.');
  }
  return amount.toString(10);
}
