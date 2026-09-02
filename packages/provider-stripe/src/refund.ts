import {
  REFUND_REASONS,
  REFUND_STATES,
  type RefundReason,
  type RefundState,
} from '@fraterunion-payments/payment-core';
import {
  ProviderContractError,
  PROVIDER_ERROR_CODES,
} from '@fraterunion-payments/provider-contracts';
import type { StripeRefundCreateParams } from './stripe-client.js';

/**
 * Stripe Refund create `reason` is only:
 * `duplicate` | `fraudulent` | `requested_by_customer`.
 *
 * Canonical reasons without a precise Stripe equivalent are omitted.
 * We do not send `requested_by_customer` for CUSTOMER_REQUEST because
 * FUP's reason is broader than Stripe's fraud/block-list side effects.
 */
export function mapStripeRefundReason(
  reason: RefundReason | undefined,
): StripeRefundCreateParams['reason'] | undefined {
  if (reason === REFUND_REASONS.DUPLICATE) {
    return 'duplicate';
  }
  if (reason === REFUND_REASONS.FRAUDULENT) {
    return 'fraudulent';
  }
  return undefined;
}

/**
 * Stripe Refund `status`: pending | requires_action | succeeded | failed | canceled.
 *
 * FUP has no canceled refund state. A Stripe-canceled refund is observed
 * as FAILED. CREATED is internal pre-provider and is never emitted here.
 */
export function mapStripeRefundStatus(status: string | null): RefundState {
  switch (status) {
    case 'pending':
    case 'requires_action':
      return REFUND_STATES.PROCESSING;
    case 'succeeded':
      return REFUND_STATES.SUCCEEDED;
    case 'failed':
    case 'canceled':
      return REFUND_STATES.FAILED;
    default:
      throw new ProviderContractError(
        'The provider returned a refund status that cannot be normalized.',
        { code: PROVIDER_ERROR_CODES.PROVIDER_CONTRACT },
      );
  }
}
