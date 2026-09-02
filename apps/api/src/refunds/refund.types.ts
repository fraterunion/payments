import type { RefundReason, RefundStatus } from '@fraterunion-payments/database';
import type { PaymentFailure } from '@fraterunion-payments/payment-core';
import { IDEMPOTENCY_SCOPES } from '../idempotency/idempotency.types';

export const REFUND_LIST_DEFAULT_LIMIT = 50;
export const REFUND_LIST_MAX_LIMIT = 100;
export const REFUND_METADATA_MAX_BYTES = 16_384;
export const REFUND_METADATA_MAX_DEPTH = 8;
export const REFUND_FAILURE_MESSAGE_MAX_LENGTH = 512;
export const REFUND_FAILURE_CODE_MAX_LENGTH = 64;
export const REFUND_CREATE_IDEMPOTENCY_SCOPE = IDEMPOTENCY_SCOPES.REFUND_CREATE;

export const REFUND_READ_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'ANALYST', 'SUPPORT'] as const;
/**
 * Human JWT write roles. DEVELOPER is included for consistency with payment
 * creation: developers already create payments and automate via API keys.
 * Refunds remain a distinct privileged scope (`refunds:write`) for API keys.
 * ANALYST and SUPPORT cannot create refunds.
 */
export const REFUND_WRITE_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER'] as const;

export type CreateRefundInput = {
  readonly organizationId: string;
  readonly paymentId: string;
  readonly amount: string;
  readonly idempotencyKey: string;
  readonly reason?: RefundReason;
  readonly metadata?: Record<string, unknown>;
};

export type RefundListCursor = {
  readonly createdAt: Date;
  readonly id: string;
};

export type ListRefundsQuery = {
  readonly organizationId: string;
  readonly paymentId?: string;
  readonly status?: RefundStatus;
  readonly reason?: RefundReason;
  readonly createdAtFrom?: Date;
  readonly createdAtTo?: Date;
  readonly limit?: number;
  readonly cursor?: RefundListCursor;
};

export type MarkRefundFailedInput = {
  readonly category: PaymentFailure['category'];
  readonly message: string;
  readonly retryable: boolean;
  readonly code?: string;
};

export type RefundCapacity = {
  readonly capturedAmount: bigint;
  readonly successfulRefundedAmount: bigint;
  readonly reservedRefundAmount: bigint;
  readonly availableRefundAmount: bigint;
};
