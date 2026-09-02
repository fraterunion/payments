export const DOMAIN_ERROR_CODES = {
  INVALID_MONEY: 'INVALID_MONEY',
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  INVALID_IDENTIFIER: 'INVALID_IDENTIFIER',
  INVALID_PAYMENT_TRANSITION: 'INVALID_PAYMENT_TRANSITION',
  INVALID_PAYMENT_AMOUNT: 'INVALID_PAYMENT_AMOUNT',
  INVALID_PAYMENT_OPERATION: 'INVALID_PAYMENT_OPERATION',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  AUTHORIZATION_EXCEEDS_REQUESTED_AMOUNT: 'AUTHORIZATION_EXCEEDS_REQUESTED_AMOUNT',
  CAPTURE_EXCEEDS_AUTHORIZED_AMOUNT: 'CAPTURE_EXCEEDS_AUTHORIZED_AMOUNT',
  REFUND_EXCEEDS_CAPTURED_AMOUNT: 'REFUND_EXCEEDS_CAPTURED_AMOUNT',
  ZERO_AMOUNT_NOT_ALLOWED: 'ZERO_AMOUNT_NOT_ALLOWED',
  INVALID_PAYMENT_FAILURE: 'INVALID_PAYMENT_FAILURE',
  INVALID_REFUND: 'INVALID_REFUND',
  PAYMENT_INVARIANT: 'PAYMENT_INVARIANT',
} as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[keyof typeof DOMAIN_ERROR_CODES];

/**
 * Domain invariant / programmer-misuse error. No HTTP status lives here;
 * the API layer translates codes later.
 */
export class PaymentDomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'PaymentDomainError';
    this.code = code;
  }
}

export class InvalidMoneyError extends PaymentDomainError {
  constructor(message: string, code: DomainErrorCode = DOMAIN_ERROR_CODES.INVALID_MONEY) {
    super(code, message);
    this.name = 'InvalidMoneyError';
  }
}

export class InvalidPaymentTransitionError extends PaymentDomainError {
  constructor(message: string) {
    super(DOMAIN_ERROR_CODES.INVALID_PAYMENT_TRANSITION, message);
    this.name = 'InvalidPaymentTransitionError';
  }
}

export class PaymentInvariantError extends PaymentDomainError {
  constructor(message: string, code: DomainErrorCode = DOMAIN_ERROR_CODES.PAYMENT_INVARIANT) {
    super(code, message);
    this.name = 'PaymentInvariantError';
  }
}

export class InvalidRefundError extends PaymentDomainError {
  constructor(message: string, code: DomainErrorCode = DOMAIN_ERROR_CODES.INVALID_REFUND) {
    super(code, message);
    this.name = 'InvalidRefundError';
  }
}

export function isPaymentDomainError(error: unknown): error is PaymentDomainError {
  return error instanceof PaymentDomainError;
}
