export function stripePaymentIntentObject(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'pi_fup_norm',
    object: 'payment_intent',
    status: 'succeeded',
    amount: 10000,
    currency: 'usd',
    capture_method: 'automatic',
    amount_capturable: 0,
    amount_received: 10000,
    last_payment_error: null,
    next_action: null,
    ...overrides,
  };
}

export function stripeRefundObject(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 're_fup_norm',
    object: 'refund',
    status: 'succeeded',
    amount: 4000,
    currency: 'usd',
    payment_intent: 'pi_fup_norm',
    ...overrides,
  };
}

export function stripeFinancialEvent(
  type: string,
  object: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const event: Record<string, unknown> = {
    id: `evt_fup_norm_${type.replaceAll('.', '_')}`,
    object: 'event',
    type,
    api_version: '2026-08-26.dahlia',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
    ...extra,
  };
  if (event['account'] === undefined) {
    delete event['account'];
  }
  return event;
}
