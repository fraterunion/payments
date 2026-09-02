import { createStripeWebhookTestSignature } from '@fraterunion-payments/provider-stripe';
import request, { type Test } from 'supertest';

export const TEST_STRIPE_WEBHOOK_SECRET = 'whsec_test_fup_webhook_not_for_production';

export function stripeWebhookEventJson(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const event: Record<string, unknown> = {
    id: 'evt_fup_test_default',
    object: 'event',
    type: 'payment_intent.succeeded',
    api_version: '2026-08-26.dahlia',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: 'pi_fup_test',
        object: 'payment_intent',
        amount: 12500,
        currency: 'usd',
        status: 'succeeded',
      },
    },
    ...overrides,
  };
  if (event['account'] === undefined) {
    delete event['account'];
  }
  return event;
}

export function stripeWebhookPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(stripeWebhookEventJson(overrides));
}

export function signStripeWebhook(
  payload: string,
  secret: string = TEST_STRIPE_WEBHOOK_SECRET,
  timestamp?: number,
): string {
  return createStripeWebhookTestSignature({
    payload,
    secret,
    ...(timestamp !== undefined ? { timestamp } : {}),
  });
}

export function postStripeWebhook(
  server: Parameters<typeof request>[0],
  payload: string,
  signature: string,
): Test {
  return request(server)
    .post('/api/v1/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', signature)
    .send(payload);
}
