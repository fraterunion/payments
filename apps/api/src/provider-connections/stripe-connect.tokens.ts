import type { StripeConnectOperations } from '@fraterunion-payments/provider-stripe';

export const STRIPE_CONNECT_PROVIDER = Symbol('STRIPE_CONNECT_PROVIDER');

export type StripeConnectProviderPort = StripeConnectOperations;
