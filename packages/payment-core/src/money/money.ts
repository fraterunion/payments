import { DOMAIN_ERROR_CODES, InvalidMoneyError } from '../errors/errors.js';
import { canonicalizeCurrencyCode, type CurrencyCode } from './currency.js';

/**
 * Integer minor units plus an explicit ISO 4217 currency.
 * Amounts are `bigint` so they are not limited to `Number.MAX_SAFE_INTEGER`.
 * Never pass a `Money` value to `JSON.stringify` — use `moneyToJSON`.
 */
export type Money = {
  readonly amount: bigint;
  readonly currency: CurrencyCode;
};

export type MoneyJSON = {
  readonly amount: string;
  readonly currency: CurrencyCode;
};

export function createMoney(amount: bigint, currency: string): Money {
  if (typeof amount !== 'bigint') {
    throw new InvalidMoneyError('Money amount must be a bigint integer in minor units.');
  }
  if (amount < 0n) {
    throw new InvalidMoneyError('Money amount cannot be negative.');
  }

  const money: Money = Object.freeze({
    amount,
    currency: canonicalizeCurrencyCode(currency),
  });
  return money;
}

export function zeroMoney(currency: string): Money {
  return createMoney(0n, currency);
}

export function moneyEquals(left: Money, right: Money): boolean {
  return left.amount === right.amount && left.currency === right.currency;
}

export function assertSameCurrency(left: Money, right: Money, message?: string): void {
  if (left.currency !== right.currency) {
    throw new InvalidMoneyError(
      message ?? `Currency mismatch: ${left.currency} vs ${right.currency}.`,
      DOMAIN_ERROR_CODES.CURRENCY_MISMATCH,
    );
  }
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return createMoney(left.amount + right.amount, left.currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  if (right.amount > left.amount) {
    throw new InvalidMoneyError('Subtraction would produce a negative money amount.');
  }
  return createMoney(left.amount - right.amount, left.currency);
}

export function moneyToJSON(money: Money): MoneyJSON {
  return {
    amount: money.amount.toString(10),
    currency: money.currency,
  };
}

export function moneyFromJSON(value: {
  readonly amount: string;
  readonly currency: string;
}): Money {
  if (!/^-?\d+$/.test(value.amount)) {
    throw new InvalidMoneyError('Money JSON amount must be a base-10 integer string.');
  }
  return createMoney(BigInt(value.amount), value.currency);
}
