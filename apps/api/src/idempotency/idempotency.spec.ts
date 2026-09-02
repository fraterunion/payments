import {
  canonicalizeIdempotencyKey,
  canonicalizeJson,
  fingerprintCanonicalPayload,
  fingerprintFinancialCommand,
  hashIdempotencyKey,
  IdempotencyFingerprintError,
  parseApiIdempotencyKey,
} from './idempotency';
import {
  IdempotencyKeyInvalidException,
  IdempotencyKeyRequiredException,
} from './idempotency.exceptions';
import {
  asIdempotencyResourceType,
  asIdempotencyScope,
  IDEMPOTENCY_SCOPES,
} from './idempotency.types';
import { paymentCreateFingerprint } from '../payments/payment-idempotency';
import { refundCreateFingerprint } from '../refunds/refund-idempotency';

describe('financial idempotency primitives', () => {
  it('trims surrounding whitespace because that was already established', () => {
    expect(canonicalizeIdempotencyKey('  abc  ')).toBe('abc');
    expect(hashIdempotencyKey(canonicalizeIdempotencyKey(' abc '))).toBe(
      hashIdempotencyKey(canonicalizeIdempotencyKey('abc')),
    );
    expect(parseApiIdempotencyKey(' abc ').keyHash).toBe(hashIdempotencyKey('abc'));
  });

  it('rejects missing, empty, oversized, and control-character keys', () => {
    expect(() => canonicalizeIdempotencyKey(undefined)).toThrow(IdempotencyKeyRequiredException);
    expect(() => canonicalizeIdempotencyKey('   ')).toThrow(IdempotencyKeyRequiredException);
    expect(() => canonicalizeIdempotencyKey('k'.repeat(256))).toThrow(
      IdempotencyKeyInvalidException,
    );
    expect(() => canonicalizeIdempotencyKey('key\u0007')).toThrow(IdempotencyKeyInvalidException);
  });

  it('does not return the raw key from parseApiIdempotencyKey', () => {
    expect(parseApiIdempotencyKey('secret-client-key')).toEqual({
      keyHash: hashIdempotencyKey('secret-client-key'),
    });
    expect(JSON.stringify(parseApiIdempotencyKey('secret-client-key'))).not.toContain(
      'secret-client-key',
    );
  });

  it('accepts only the closed lowercase-dot scope registry', () => {
    expect(asIdempotencyScope('payment.create')).toBe(IDEMPOTENCY_SCOPES.PAYMENT_CREATE);
    expect(asIdempotencyScope('payment.capture')).toBe(IDEMPOTENCY_SCOPES.PAYMENT_CAPTURE);
    expect(asIdempotencyScope('refund.execute')).toBe(IDEMPOTENCY_SCOPES.REFUND_EXECUTE);
    expect(() => asIdempotencyScope('stripe.charge')).toThrow(/registered/);
    expect(() => asIdempotencyScope('Payment.Create')).toThrow(/lowercase/);
    expect(() => asIdempotencyScope('payment.create\n')).toThrow(/lowercase/);
    expect(() => asIdempotencyScope('custom.namespace')).toThrow(/registered/);
  });

  it('rejects unregistered resource types', () => {
    expect(asIdempotencyResourceType('payment')).toBe('payment');
    expect(() => asIdempotencyResourceType('PaymentIntent')).toThrow();
    expect(() => asIdempotencyResourceType('stripe_refund')).toThrow();
  });

  it('sorts object keys including nested objects and preserves array order', () => {
    expect(canonicalizeJson({ z: 1, a: { c: 2, b: 1 } })).toEqual({
      a: { b: 1, c: 2 },
      z: 1,
    });
    expect(fingerprintCanonicalPayload({ items: ['a', 'b'] })).not.toBe(
      fingerprintCanonicalPayload({ items: ['b', 'a'] }),
    );
    expect(fingerprintCanonicalPayload({ z: 1, a: { c: 2, b: 1 } })).toBe(
      fingerprintCanonicalPayload({ a: { b: 1, c: 2 }, z: 1 }),
    );
  });

  it('serializes bigint deterministically and rejects unsupported values', () => {
    expect(canonicalizeJson(10n)).toBe('10');
    expect(fingerprintCanonicalPayload({ amount: 10n })).toBe(
      fingerprintCanonicalPayload({ amount: '10' }),
    );
    expect(() => canonicalizeJson(Number.NaN)).toThrow(IdempotencyFingerprintError);
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow(IdempotencyFingerprintError);
    expect(() => canonicalizeJson(undefined)).toThrow(IdempotencyFingerprintError);
    expect(() => canonicalizeJson(() => undefined)).toThrow(IdempotencyFingerprintError);
    expect(() => canonicalizeJson(Symbol('x'))).toThrow(IdempotencyFingerprintError);
    expect(() => canonicalizeJson(new Date('2026-01-01T00:00:00.000Z'))).toThrow(
      IdempotencyFingerprintError,
    );
  });

  it('domain-separates fingerprints by scope even when the request body matches', () => {
    const request = { amount: '5000', metadata: {} };
    const capture = fingerprintFinancialCommand({
      scope: IDEMPOTENCY_SCOPES.PAYMENT_CAPTURE,
      organizationId: 'org-1',
      request,
    });
    const refund = fingerprintFinancialCommand({
      scope: IDEMPOTENCY_SCOPES.REFUND_CREATE,
      organizationId: 'org-1',
      request,
    });
    expect(capture).not.toBe(refund);
    expect(capture).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps payment.create fingerprints byte-compatible with the previous implementation', () => {
    const digest = paymentCreateFingerprint({
      organizationId: 'org-1',
      customerId: 'cust-1',
      requestedAmount: 12500n,
      currency: 'USD',
      captureMethod: 'AUTOMATIC',
      description: 'Order',
      metadata: { b: 2, a: 1 },
    });
    expect(digest).toBe('dc5bbac1aa65dab1714af4ee70ddf7f87f6ac130bbe313dbcd28bcd8d391acfa');
  });

  it('keeps refund.create fingerprints byte-compatible with the previous implementation', () => {
    const digest = refundCreateFingerprint({
      organizationId: 'org-1',
      paymentId: 'pay-1',
      amount: 5000n,
      reason: 'CUSTOMER_REQUEST',
      metadata: { b: 2, a: 1 },
    });
    expect(digest).toBe('925788af26ddd1f24c61a3aa74f95c83df08b4f2e61527a803df308861000a0f');
  });
});
