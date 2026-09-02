export type RefundCapacitySnapshot = {
  readonly capturedAmount: bigint;
  readonly successfulRefundedAmount: bigint;
  readonly reservedRefundAmount: bigint;
  readonly availableRefundAmount: bigint;
};

/**
 * Reservation includes CREATED + PROCESSING + SUCCEEDED.
 * `successfulRefundedAmount` is SUCCEEDED only (`Payment.refundedAmount`).
 */
export function computeRefundCapacity(input: {
  readonly capturedAmount: bigint;
  readonly successfulRefundedAmount: bigint;
  readonly reservedRefundAmount: bigint;
}): RefundCapacitySnapshot {
  const available = input.capturedAmount - input.reservedRefundAmount;
  return {
    capturedAmount: input.capturedAmount,
    successfulRefundedAmount: input.successfulRefundedAmount,
    reservedRefundAmount: input.reservedRefundAmount,
    availableRefundAmount: available < 0n ? 0n : available,
  };
}

export function asBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new TypeError('Expected an integer minor-unit value.');
}
