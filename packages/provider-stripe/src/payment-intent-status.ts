import { PAYMENT_STATES, type PaymentState } from '@fraterunion-payments/payment-core';
import {
  ProviderContractError,
  PROVIDER_ERROR_CODES,
} from '@fraterunion-payments/provider-contracts';

export type StripePaymentOperation = 'create' | 'capture' | 'cancel' | 'retrieve';

/**
 * Stripe PaymentIntent statuses for API version 2026-08-26.dahlia:
 * canceled | processing | requires_action | requires_capture |
 * requires_confirmation | requires_payment_method | succeeded
 *
 * There is no Stripe equivalent of internal CREATED. Adapters never emit it.
 */
export function mapStripePaymentIntentStatus(input: {
  readonly status: string;
  readonly captureMethod: string;
  readonly operation: StripePaymentOperation;
}): PaymentState {
  switch (input.status) {
    case 'requires_payment_method':
      return PAYMENT_STATES.REQUIRES_PAYMENT_METHOD;
    case 'requires_confirmation':
    case 'requires_action':
      return PAYMENT_STATES.REQUIRES_ACTION;
    case 'processing':
      if (input.operation === 'capture') {
        return PAYMENT_STATES.CAPTURING;
      }
      if (input.captureMethod === 'manual') {
        return PAYMENT_STATES.AUTHORIZING;
      }
      return PAYMENT_STATES.CAPTURING;
    case 'requires_capture':
      return PAYMENT_STATES.AUTHORIZED;
    case 'succeeded':
      return PAYMENT_STATES.SUCCEEDED;
    case 'canceled':
      return PAYMENT_STATES.CANCELED;
    default:
      throw new ProviderContractError(
        'The provider returned a payment status that cannot be normalized.',
        { code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT },
      );
  }
}
