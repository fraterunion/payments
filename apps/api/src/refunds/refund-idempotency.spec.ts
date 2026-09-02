import { refundCreateFingerprint } from './refund-idempotency';
import { REFUND_CREATE_IDEMPOTENCY_SCOPE } from './refund.types';

describe('refund create idempotency fingerprint', () => {
  it('canonicalizes field order so raw JSON order cannot create a second refund', () => {
    const left = refundCreateFingerprint({
      organizationId: 'org-1',
      paymentId: 'pay-1',
      amount: 5000n,
      reason: 'CUSTOMER_REQUEST',
      metadata: { b: 2, a: 1 },
    });
    const right = refundCreateFingerprint({
      paymentId: 'pay-1',
      metadata: { a: 1, b: 2 },
      amount: 5000n,
      organizationId: 'org-1',
      reason: 'CUSTOMER_REQUEST',
    });
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when amount, reason, payment, or metadata changes', () => {
    const base = {
      organizationId: 'org-1',
      paymentId: 'pay-1',
      amount: 5000n,
      metadata: {},
    };
    expect(refundCreateFingerprint(base)).not.toBe(
      refundCreateFingerprint({ ...base, amount: 5001n }),
    );
    expect(refundCreateFingerprint(base)).not.toBe(
      refundCreateFingerprint({ ...base, reason: 'DUPLICATE' }),
    );
    expect(refundCreateFingerprint(base)).not.toBe(
      refundCreateFingerprint({ ...base, paymentId: 'pay-2' }),
    );
    expect(refundCreateFingerprint(base)).not.toBe(
      refundCreateFingerprint({ ...base, metadata: { note: 'x' } }),
    );
  });

  it('uses the refund.create scope, not payment.create', () => {
    expect(REFUND_CREATE_IDEMPOTENCY_SCOPE).toBe('refund.create');
  });
});
