import { computeRefundCapacity, asBigInt } from './refund-capacity';

describe('refund capacity', () => {
  it('treats reserved capacity as CREATED+PROCESSING+SUCCEEDED against captured funds', () => {
    const capacity = computeRefundCapacity({
      capturedAmount: 10000n,
      successfulRefundedAmount: 0n,
      reservedRefundAmount: 3000n,
    });
    expect(capacity.availableRefundAmount).toBe(7000n);
    expect(capacity.successfulRefundedAmount).toBe(0n);
    expect(capacity.reservedRefundAmount).toBe(3000n);
  });

  it('does not treat successful refunded as extra reservation', () => {
    const capacity = computeRefundCapacity({
      capturedAmount: 10000n,
      successfulRefundedAmount: 3000n,
      reservedRefundAmount: 3000n,
    });
    expect(capacity.availableRefundAmount).toBe(7000n);
  });

  it('coerces integer wire values to bigint without using floats', () => {
    expect(asBigInt(10000n)).toBe(10000n);
    expect(asBigInt('10000')).toBe(10000n);
    expect(asBigInt(10000)).toBe(10000n);
    expect(() => asBigInt(10.5)).toThrow(/integer minor-unit/);
  });
});
