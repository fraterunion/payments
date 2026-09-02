import type {
  PaymentCaptureMethod,
  PaymentFailureCategory,
  PaymentStatus,
} from '@fraterunion-payments/database';
import type { PaymentFailure } from '@fraterunion-payments/payment-core';

export const PAYMENT_LIST_DEFAULT_LIMIT = 50;
export const PAYMENT_LIST_MAX_LIMIT = 100;
export const PAYMENT_METADATA_MAX_BYTES = 16_384;
export const PAYMENT_METADATA_MAX_DEPTH = 8;
export const PAYMENT_DESCRIPTION_MAX_LENGTH = 500;
export const PAYMENT_FAILURE_MESSAGE_MAX_LENGTH = 512;
export const PAYMENT_FAILURE_CODE_MAX_LENGTH = 64;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
export const PAYMENT_CREATE_IDEMPOTENCY_SCOPE = 'payment.create';

export const PAYMENT_READ_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'ANALYST', 'SUPPORT'] as const;
export const PAYMENT_WRITE_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER'] as const;

export type CreatePaymentInput = {
  readonly organizationId: string;
  readonly amount: string;
  readonly currency: string;
  readonly captureMethod: PaymentCaptureMethod;
  readonly idempotencyKey: string;
  readonly customerId?: string;
  readonly description?: string;
  readonly metadata?: Record<string, unknown>;
};

export type PaymentListCursor = {
  readonly createdAt: Date;
  readonly id: string;
};

export type ListPaymentsQuery = {
  readonly organizationId: string;
  readonly status?: PaymentStatus;
  readonly customerId?: string;
  readonly currency?: string;
  readonly captureMethod?: PaymentCaptureMethod;
  readonly createdAtFrom?: Date;
  readonly createdAtTo?: Date;
  readonly limit?: number;
  readonly cursor?: PaymentListCursor;
};

export type MarkFailedInput = {
  readonly category: PaymentFailureCategory;
  readonly message: string;
  readonly retryable: boolean;
  readonly code?: string;
};

export type NormalizedPaymentFailure = PaymentFailure;
