import type { PaymentCaptureMethod } from '@fraterunion-payments/database';
import { fingerprintFinancialCommand } from '../idempotency/idempotency';
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

export {
  canonicalizeIdempotencyKey,
  canonicalizeJson,
  hashIdempotencyKey,
} from '../idempotency/idempotency';

/**
 * Canonical fingerprint of semantically relevant payment-create fields.
 * Domain-separated with `payment.create` + organizationId. Object-key
 * order cannot produce a different digest.
 */
export function paymentCreateFingerprint(input: PaymentCreateFingerprintInput): string {
  return fingerprintFinancialCommand({
    scope: IDEMPOTENCY_SCOPES.PAYMENT_CREATE,
    organizationId: input.organizationId,
    request: {
      customerId: input.customerId ?? null,
      requestedAmount: input.requestedAmount.toString(10),
      currency: input.currency,
      captureMethod: input.captureMethod,
      description: input.description ?? null,
      metadata: input.metadata,
    },
  });
}
