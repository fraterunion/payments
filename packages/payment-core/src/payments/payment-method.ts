import { DOMAIN_ERROR_CODES, PaymentInvariantError } from '../errors/errors.js';

export const PAYMENT_METHOD_TYPES = {
  CARD: 'CARD',
  BANK_ACCOUNT: 'BANK_ACCOUNT',
  WALLET: 'WALLET',
  OTHER: 'OTHER',
} as const;

export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[keyof typeof PAYMENT_METHOD_TYPES];

/**
 * Provider-safe tokenized reference only. Never PAN, CVC, or track data.
 */
export type PaymentMethodReference = {
  readonly id: string;
  readonly type: PaymentMethodType;
};

const PAYMENT_METHOD_TYPE_SET: ReadonlySet<string> = new Set(Object.values(PAYMENT_METHOD_TYPES));

export function createPaymentMethodReference(input: {
  readonly id: string;
  readonly type: PaymentMethodType;
}): PaymentMethodReference {
  const id = input.id.trim();
  if (id.length === 0) {
    throw new PaymentInvariantError(
      'Payment method reference id is required.',
      DOMAIN_ERROR_CODES.INVALID_IDENTIFIER,
    );
  }
  if (!PAYMENT_METHOD_TYPE_SET.has(input.type)) {
    throw new PaymentInvariantError('Payment method type is not recognized.');
  }
  return Object.freeze({ id, type: input.type });
}

/**
 * Customer action required before authorization can continue.
 * Not stored on the payment aggregate — it is a provider-boundary result.
 */
export const PAYMENT_ACTION_REQUIREMENT_TYPES = {
  REDIRECT: 'REDIRECT',
  SDK: 'SDK',
  DISPLAY_INSTRUCTIONS: 'DISPLAY_INSTRUCTIONS',
} as const;

export type PaymentActionRequirementType =
  (typeof PAYMENT_ACTION_REQUIREMENT_TYPES)[keyof typeof PAYMENT_ACTION_REQUIREMENT_TYPES];

export type PaymentActionRequirement = {
  readonly type: PaymentActionRequirementType;
};
