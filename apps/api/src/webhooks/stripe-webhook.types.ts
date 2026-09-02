export const STRIPE_INBOX_SOURCE = 'stripe' as const;

export type StripeWebhookAck = {
  readonly received: true;
};
