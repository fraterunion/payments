import type { PaymentCaptureMethod } from '@fraterunion-payments/database';
import {
  canonicalizeIdempotencyKey,
  canonicalizeJson,
  fingerprintCanonicalPayload,
  hashIdempotencyKey,
} from '../idempotency/idempotency';
import { IDEMPOTENCY_SCOPES } from '../idempotency/idempotency.types';

export type PaymentCreateFingerprintInput = {
  readonly organizationId: string;
  readonly customerId?: string;
  readonly requestedAmount: bigint;
  readonly currency: string;
  readonly captureMethod: PaymentCaptureMethod;
  readonly description?: string;
  readonly metadata: Record<string, unknown>;
};

export { canonicalizeIdempotencyKey, canonicalizeJson, hashIdempotencyKey };

/**
 * Canonical fingerprint of semantically relevant payment-create fields.
 * Key order is sorted so raw JSON property order cannot create a second payment.
 */
export function paymentCreateFingerprint(input: PaymentCreateFingerprintInput): string {
  return fingerprintCanonicalPayload({
    scope: IDEMPOTENCY_SCOPES.PAYMENT_CREATE,
    organizationId: input.organizationId,
    customerId: input.customerId ?? null,
    requestedAmount: input.requestedAmount.toString(10),
    currency: input.currency,
    captureMethod: input.captureMethod,
    description: input.description ?? null,
    metadata: input.metadata,
  });
}
