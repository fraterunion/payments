import { describe, expect, it } from 'vitest';
import { DOMAIN_ERROR_CODES } from '../errors/errors.js';
import { canonicalizeCurrencyCode } from './currency.js';
import {
  addMoney,
  createMoney,
  moneyEquals,
  moneyFromJSON,
  moneyToJSON,
  subtractMoney,
  zeroMoney,
} from './money.js';

describe('Money', () => {
  it('creates an immutable zero and positive amount', () => {
    const zero = zeroMoney('usd');
    const money = createMoney(12500n, 'usd');
    expect(zero.amount).toBe(0n);
    expect(zero.currency).toBe('USD');
    expect(money.amount).toBe(12500n);
    expect(money.currency).toBe('USD');
    expect(() => {
      (money as { amount: bigint }).amount = 1n;
    }).toThrow();
  });

  it('accepts a very large bigint amount', () => {
    const amount = 10n ** 24n;
    expect(createMoney(amount, 'JPY').amount).toBe(amount);
  });

  it('rejects negative amounts', () => {
    expect(() => createMoney(-1n, 'USD')).toThrowError(/negative/);
  });

  it('canonicalizes currency and rejects invalid codes', () => {
    expect(canonicalizeCurrencyCode(' mxn ')).toBe('MXN');
    expect(() => canonicalizeCurrencyCode('')).toThrowError(/three ASCII letters/);
    expect(() => canonicalizeCurrencyCode('US')).toThrowError(/three ASCII letters/);
    expect(() => canonicalizeCurrencyCode('usd1')).toThrowError(/three ASCII letters/);
    expect(() => canonicalizeCurrencyCode('XXX')).toThrowError(/not an accepted/);
    expect(() => canonicalizeCurrencyCode('XTS')).toThrowError(/not an accepted/);
  });

  it('rejects currency mismatch and serializes without bigint JSON', () => {
    const usd = createMoney(100n, 'USD');
    const mxn = createMoney(100n, 'MXN');
    expect(() => addMoney(usd, mxn)).toThrowError(/Currency mismatch/);
    expect(moneyEquals(usd, createMoney(100n, 'USD'))).toBe(true);
    expect(moneyToJSON(usd)).toEqual({ amount: '100', currency: 'USD' });
    expect(moneyFromJSON({ amount: '100', currency: 'usd' })).toEqual(usd);
    expect(() => moneyFromJSON({ amount: '10.5', currency: 'USD' })).toThrowError(/integer string/);
    expect(() => JSON.stringify(usd)).toThrowError(/BigInt/);
  });

  it('adds and subtracts same-currency amounts', () => {
    const left = createMoney(100n, 'USD');
    const right = createMoney(40n, 'USD');
    expect(addMoney(left, right).amount).toBe(140n);
    expect(subtractMoney(left, right).amount).toBe(60n);
    expect(() => subtractMoney(right, left)).toThrowError(/negative/);
  });

  it('uses INVALID_CURRENCY for unknown codes', () => {
    try {
      createMoney(1n, 'ZZZ');
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: DOMAIN_ERROR_CODES.INVALID_CURRENCY });
    }
  });
});
