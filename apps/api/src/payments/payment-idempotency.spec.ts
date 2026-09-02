import {
  canonicalizeIdempotencyKey,
  canonicalizeJson,
  hashIdempotencyKey,
  paymentCreateFingerprint,
} from './payment-idempotency';
import {
  IdempotencyKeyInvalidException,
  IdempotencyKeyRequiredException,
} from './payment.exceptions';

describe('payment create idempotency', () => {
  it('canonicalizes and hashes the Idempotency-Key', () => {
    const key = canonicalizeIdempotencyKey('  pay-create-1  ');
    expect(key).toBe('pay-create-1');
    expect(hashIdempotencyKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIdempotencyKey(key)).toBe(hashIdempotencyKey('pay-create-1'));
  });

  it('rejects missing, empty, oversized, and control-character keys', () => {
    expect(() => canonicalizeIdempotencyKey(undefined)).toThrow(IdempotencyKeyRequiredException);
    expect(() => canonicalizeIdempotencyKey('   ')).toThrow(IdempotencyKeyRequiredException);
    expect(() => canonicalizeIdempotencyKey('k'.repeat(256))).toThrow(
      IdempotencyKeyInvalidException,
    );
    expect(() => canonicalizeIdempotencyKey('key\u0007')).toThrow(IdempotencyKeyInvalidException);
  });

  it('fingerprints canonical field order, not raw JSON order', () => {
    const left = paymentCreateFingerprint({
      organizationId: 'org-1',
      customerId: 'cust-1',
      requestedAmount: 12500n,
      currency: 'USD',
      captureMethod: 'AUTOMATIC',
      description: 'Order',
      metadata: { b: 2, a: 1 },
    });
    const right = paymentCreateFingerprint({
      organizationId: 'org-1',
      requestedAmount: 12500n,
      currency: 'USD',
      captureMethod: 'AUTOMATIC',
      description: 'Order',
      customerId: 'cust-1',
      metadata: { a: 1, b: 2 },
    });
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the fingerprint when a material field changes', () => {
    const base = {
      organizationId: 'org-1',
      requestedAmount: 12500n,
      currency: 'USD',
      captureMethod: 'AUTOMATIC' as const,
      metadata: {},
    };
    expect(paymentCreateFingerprint(base)).not.toBe(
      paymentCreateFingerprint({ ...base, requestedAmount: 12501n }),
    );
    expect(paymentCreateFingerprint(base)).not.toBe(
      paymentCreateFingerprint({ ...base, captureMethod: 'MANUAL' }),
    );
  });

  it('sorts nested object keys', () => {
    expect(canonicalizeJson({ z: 1, a: { c: 2, b: 1 } })).toEqual({
      a: { b: 1, c: 2 },
      z: 1,
    });
  });
});
