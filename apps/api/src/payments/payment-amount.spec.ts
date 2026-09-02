import { parsePositiveMinorUnitAmount, serializeMinorUnitAmount } from './payment-amount';
import { InvalidPaymentAmountException } from './payment.exceptions';

describe('payment amount transport', () => {
  it('parses a positive minor-unit decimal string', () => {
    expect(parsePositiveMinorUnitAmount('12500')).toBe(12500n);
    expect(parsePositiveMinorUnitAmount('1')).toBe(1n);
  });

  it('rejects floats, decimals, zero, signs, and leading zeros', () => {
    expect(() => parsePositiveMinorUnitAmount('125.50')).toThrow(InvalidPaymentAmountException);
    expect(() => parsePositiveMinorUnitAmount('125.00')).toThrow(InvalidPaymentAmountException);
    expect(() => parsePositiveMinorUnitAmount('0')).toThrow(InvalidPaymentAmountException);
    expect(() => parsePositiveMinorUnitAmount('-12500')).toThrow(InvalidPaymentAmountException);
    expect(() => parsePositiveMinorUnitAmount('012500')).toThrow(InvalidPaymentAmountException);
    expect(() => parsePositiveMinorUnitAmount('')).toThrow(InvalidPaymentAmountException);
  });

  it('serializes bigint without JSON.stringify', () => {
    expect(serializeMinorUnitAmount(12500n)).toBe('12500');
    expect(() => JSON.stringify({ amount: 12500n })).toThrow(/BigInt/);
  });
});
