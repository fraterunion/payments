import { DOMAIN_ERROR_CODES, PaymentInvariantError } from '../errors/errors.js';

export const PAYMENT_FAILURE_CATEGORIES = {
  DECLINED: 'DECLINED',
  AUTHENTICATION: 'AUTHENTICATION',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  INVALID_PAYMENT_METHOD: 'INVALID_PAYMENT_METHOD',
  PROCESSING: 'PROCESSING',
  PROVIDER: 'PROVIDER',
  UNKNOWN: 'UNKNOWN',
} as const;

export type PaymentFailureCategory =
  (typeof PAYMENT_FAILURE_CATEGORIES)[keyof typeof PAYMENT_FAILURE_CATEGORIES];

export type PaymentFailure = {
  readonly category: PaymentFailureCategory;
  readonly code?: string;
  readonly message: string;
  readonly retryable: boolean;
};

const CATEGORY_SET: ReadonlySet<string> = new Set(Object.values(PAYMENT_FAILURE_CATEGORIES));

export function createPaymentFailure(input: {
  readonly category: PaymentFailureCategory;
  readonly message: string;
  readonly retryable: boolean;
  readonly code?: string;
}): PaymentFailure {
  if (!CATEGORY_SET.has(input.category)) {
    throw new PaymentInvariantError(
      'Payment failure category is not recognized.',
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_FAILURE,
    );
  }
  const message = input.message.trim();
  if (message.length === 0) {
    throw new PaymentInvariantError(
      'Payment failure message is required.',
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_FAILURE,
    );
  }
  if (typeof input.retryable !== 'boolean') {
    throw new PaymentInvariantError(
      'Payment failure retryable must be a boolean.',
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_FAILURE,
    );
  }

  const code = input.code === undefined ? undefined : input.code.trim();
  if (code !== undefined && code.length === 0) {
    throw new PaymentInvariantError(
      'Payment failure code, if present, must be non-empty.',
      DOMAIN_ERROR_CODES.INVALID_PAYMENT_FAILURE,
    );
  }

  return Object.freeze({
    category: input.category,
    message,
    retryable: input.retryable,
    ...(code !== undefined ? { code } : {}),
  });
}
