/**
 * Pinned Stripe API version for this adapter.
 *
 * Must be set explicitly on the Stripe client. Do not rely on the
 * Stripe account default version.
 *
 * This is the `LatestApiVersion` shipped with stripe-node 22.6.1.
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia' as const;

export type StripeApiVersion = typeof STRIPE_API_VERSION;
