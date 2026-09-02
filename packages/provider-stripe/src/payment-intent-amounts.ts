import { createMoney, type Money } from '@fraterunion-payments/payment-core';
import { fromStripeAmount } from './money.js';
import type { StripePaymentIntentSnapshot } from './stripe-client.js';

export type ObservedPaymentAmounts = {
  readonly requestedAmount: Money;
  readonly authorizedAmount?: Money;
  readonly capturedAmount?: Money;
};

/**
 * Stripe amount fields (PaymentIntent):
 *
 * - `amount` — requested / original PaymentIntent amount
 * - `amount_received` — funds captured so far
 * - `amount_capturable` — remaining authorized hold
 *
 * Formulas used by this adapter:
 *
 *     capturedAmount    = amount_received when > 0, else omitted
 *     authorizedAmount  = amount_capturable + amount_received when > 0, else omitted
 *
 * Manual `requires_capture`: capturable = requested, received = 0
 *   → authorizedAmount = requested, captured omitted.
 *
 * Automatic `succeeded`: capturable = 0, received = requested
 *   → both authorized and captured equal the requested amount.
 *
 * Default final partial capture: remaining hold is released, so
 * authorizedAmount collapses to the captured amount. That is Stripe's
 * observation after a final capture, not a historical authorization.
 *
 * `amount_received` is never treated as authorized for uncaptured
 * manual payments.
 */
export function mapStripePaymentIntentAmounts(
  intent: StripePaymentIntentSnapshot,
): ObservedPaymentAmounts {
  const currency = intent.currency;
  const requestedAmount = createMoney(fromStripeAmount(intent.amount), currency);
  const capturable = fromStripeAmount(intent.amount_capturable);
  const received = fromStripeAmount(intent.amount_received);
  const authorizedMinor = capturable + received;

  return {
    requestedAmount,
    ...(authorizedMinor > 0n ? { authorizedAmount: createMoney(authorizedMinor, currency) } : {}),
    ...(received > 0n ? { capturedAmount: createMoney(received, currency) } : {}),
  };
}
