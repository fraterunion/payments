import type { RefundReason } from '@fraterunion-payments/database';
import { fingerprintFinancialCommand } from '../idempotency/idempotency';
import { REFUND_CREATE_IDEMPOTENCY_SCOPE } from './refund.types';

export type RefundCreateFingerprintInput = {
  readonly organizationId: string;
  readonly paymentId: string;
  readonly amount: bigint;
  readonly reason?: RefundReason;
  readonly metadata: Record<string, unknown>;
};

export function refundCreateFingerprint(input: RefundCreateFingerprintInput): string {
  return fingerprintFinancialCommand({
    scope: REFUND_CREATE_IDEMPOTENCY_SCOPE,
    organizationId: input.organizationId,
    request: {
      paymentId: input.paymentId,
      amount: input.amount.toString(10),
      reason: input.reason ?? null,
      metadata: input.metadata,
    },
  });
}
