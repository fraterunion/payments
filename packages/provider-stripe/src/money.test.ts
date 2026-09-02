import { createMoney } from '@fraterunion-payments/payment-core';
import { ProviderContractError } from '@fraterunion-payments/provider-contracts';
import { describe, expect, it } from 'vitest';
import {
  fromStripeAmount,
  moneyFromStripe,
  STRIPE_MAX_SAFE_AMOUNT,
  toStripeAmount,
  toStripeCurrency,
} from './money.js';

describe('Stripe money conversion', () => {
  it('converts bigint minor units to a safe Stripe integer', () => {
    expect(toStripeAmount(2500n)).toBe(2500);
    expect(toStripeCurrency('USD')).toBe('usd');
  });

  it('rejects zero, non-bigint, and overflow amounts before Number(bigint)', () => {
    expect(() => toStripeAmount(0n)).toThrow(ProviderContractError);
    expect(() => toStripeAmount(STRIPE_MAX_SAFE_AMOUNT + 1n)).toThrow(/safe integer range/);
    expect(() => toStripeAmount(Number.MAX_SAFE_INTEGER as unknown as bigint)).toThrow(
      ProviderContractError,
    );
  });

  it('converts Stripe integers back to bigint without precision loss', () => {
    expect(fromStripeAmount(0)).toBe(0n);
    expect(fromStripeAmount(99)).toBe(99n);
    expect(moneyFromStripe(1999, 'usd')).toEqual(createMoney(1999n, 'USD'));
  });

  it('rejects unsafe Stripe numeric amounts', () => {
    expect(() => fromStripeAmount(1.5)).toThrow(ProviderContractError);
    expect(() => fromStripeAmount(Number.POSITIVE_INFINITY)).toThrow(ProviderContractError);
    expect(() => fromStripeAmount(-1)).toThrow(ProviderContractError);
    expect(() => fromStripeAmount(Number.MAX_SAFE_INTEGER + 1)).toThrow(ProviderContractError);
  });
});
