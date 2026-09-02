import {
  PAYMENT_ACTION_REQUIREMENT_TYPES,
  type PaymentActionRequirement,
} from '@fraterunion-payments/payment-core';
import type { StripeNextActionSource } from './stripe-client.js';

const REDIRECT_TYPES = new Set([
  'redirect_to_url',
  'alipay_handle_redirect',
  'wechat_pay_redirect_to_android_app',
  'wechat_pay_redirect_to_ios_app',
]);

const SDK_TYPES = new Set(['use_stripe_sdk']);

const DISPLAY_TYPES = new Set([
  'boleto_display_details',
  'display_bank_transfer_instructions',
  'klarna_display_qr_code',
  'konbini_display_details',
  'multibanco_display_details',
  'oxxo_display_details',
  'paynow_display_qr_code',
  'pix_display_qr_code',
  'promptpay_display_qr_code',
  'verify_with_microdeposits',
  'wechat_pay_display_qr_code',
  'cashapp_handle_redirect_or_display_qr_code',
  'swish_handle_redirect_or_display_qr_code',
  'upi_handle_redirect_or_display_qr_code',
]);

/**
 * Maps Stripe `next_action.type` to a canonical action requirement.
 *
 * Only the type is returned. Core has no execution-artifact slot, so
 * redirect URLs, Stripe.js payloads, and `client_secret` are not copied.
 * Unknown types yield `undefined` rather than leaking Stripe shape.
 */
export function mapStripeNextAction(
  nextAction: StripeNextActionSource | null | undefined,
): PaymentActionRequirement | undefined {
  if (nextAction === null || nextAction === undefined) {
    return undefined;
  }
  if (REDIRECT_TYPES.has(nextAction.type)) {
    return { type: PAYMENT_ACTION_REQUIREMENT_TYPES.REDIRECT };
  }
  if (SDK_TYPES.has(nextAction.type)) {
    return { type: PAYMENT_ACTION_REQUIREMENT_TYPES.SDK };
  }
  if (DISPLAY_TYPES.has(nextAction.type)) {
    return { type: PAYMENT_ACTION_REQUIREMENT_TYPES.DISPLAY_INSTRUCTIONS };
  }
  return undefined;
}
