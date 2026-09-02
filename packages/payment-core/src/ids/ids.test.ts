import { describe, expect, it } from 'vitest';
import { asCustomerId, asOrganizationId, asPaymentId, asRefundId } from './ids.js';

const UUID = '01234567-89ab-7cde-8f01-23456789abcd';

describe('domain identifiers', () => {
  it('accepts UUID-compatible values and brands them separately', () => {
    const paymentId = asPaymentId(UUID);
    const refundId = asRefundId(UUID);
    expect(paymentId).toBe(UUID);
    expect(refundId).toBe(UUID);
    expect(asOrganizationId(UUID.toUpperCase())).toBe(UUID);
    expect(asCustomerId(UUID)).toBe(UUID);
  });

  it('rejects empty and non-UUID values', () => {
    expect(() => asPaymentId('')).toThrowError(/UUID/);
    expect(() => asPaymentId('not-a-uuid')).toThrowError(/UUID/);
    expect(() => asRefundId('provider-local-id')).toThrowError(/UUID/);
  });
});
