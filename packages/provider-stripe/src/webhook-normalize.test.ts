import { describe, expect, it } from 'vitest';
import { PAYMENT_STATES, REFUND_STATES } from '@fraterunion-payments/payment-core';
import { normalizeStripeFinancialEvent, StripeWebhookNormalizeError } from './webhook-normalize.js';

function paymentIntentEvent(
  type: string,
  intent: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'evt_norm_1',
    object: 'event',
    type,
    api_version: '2025-01-01.acacia',
    created: 1_725_280_000,
    livemode: false,
    data: { object: intent },
    ...extra,
  };
}

function paymentIntent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pi_norm_1',
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

describe('normalizeStripeFinancialEvent', () => {
  it('maps a succeeded PaymentIntent snapshot through the retrieve observation mapper', () => {
    const normalized = normalizeStripeFinancialEvent(
      paymentIntentEvent('payment_intent.succeeded', paymentIntent()),
    );
    expect(normalized.kind).toBe('payment');
    if (normalized.kind !== 'payment') {
      return;
    }
    expect(normalized.observation.state).toBe(PAYMENT_STATES.SUCCEEDED);
    expect(normalized.observation.authorizedAmount?.amount).toBe(10000n);
    expect(normalized.observation.capturedAmount?.amount).toBe(10000n);
    expect(normalized.providerPayment.id).toBe('pi_norm_1');
    expect(normalized.providerAccount).toBeUndefined();
  });

  it('maps manual requires_capture to AUTHORIZED using capturable + received', () => {
    const normalized = normalizeStripeFinancialEvent(
      paymentIntentEvent(
        'payment_intent.amount_capturable_updated',
        paymentIntent({
          status: 'requires_capture',
          capture_method: 'manual',
          amount_capturable: 10000,
          amount_received: 0,
        }),
      ),
    );
    expect(normalized.kind).toBe('payment');
    if (normalized.kind !== 'payment') {
      return;
    }
    expect(normalized.observation.state).toBe(PAYMENT_STATES.AUTHORIZED);
    expect(normalized.observation.authorizedAmount?.amount).toBe(10000n);
    expect(normalized.observation.capturedAmount).toBeUndefined();
  });

  it('maps payment_failed requires_payment_method, not terminal FAILED', () => {
    const normalized = normalizeStripeFinancialEvent(
      paymentIntentEvent(
        'payment_intent.payment_failed',
        paymentIntent({
          status: 'requires_payment_method',
          amount_capturable: 0,
          amount_received: 0,
          last_payment_error: { code: 'card_declined', message: 'Declined', type: 'card_error' },
        }),
      ),
    );
    expect(normalized.kind).toBe('payment');
    if (normalized.kind !== 'payment') {
      return;
    }
    expect(normalized.observation.state).toBe(PAYMENT_STATES.REQUIRES_PAYMENT_METHOD);
    expect(normalized.observation.failure).toBeDefined();
  });

  it('maps processing using capture_method without guessing operation', () => {
    const automatic = normalizeStripeFinancialEvent(
      paymentIntentEvent('payment_intent.processing', paymentIntent({ status: 'processing' })),
    );
    expect(automatic.kind).toBe('payment');
    if (automatic.kind === 'payment') {
      expect(automatic.observation.state).toBe(PAYMENT_STATES.CAPTURING);
    }
    const manual = normalizeStripeFinancialEvent(
      paymentIntentEvent(
        'payment_intent.processing',
        paymentIntent({
          status: 'processing',
          capture_method: 'manual',
          amount_capturable: 10000,
          amount_received: 0,
        }),
      ),
    );
    expect(manual.kind).toBe('payment');
    if (manual.kind === 'payment') {
      expect(manual.observation.state).toBe(PAYMENT_STATES.AUTHORIZING);
    }
  });

  it('takes Connect account from event.account, never PaymentIntent metadata', () => {
    const normalized = normalizeStripeFinancialEvent(
      paymentIntentEvent(
        'payment_intent.succeeded',
        paymentIntent({ metadata: { organizationId: 'org_spoof', account: 'acct_spoof' } }),
        { account: 'acct_connected_1' },
      ),
    );
    expect(normalized.kind).toBe('payment');
    if (normalized.kind !== 'payment') {
      return;
    }
    expect(normalized.providerAccount?.id).toBe('acct_connected_1');
  });

  it('ignores payment_intent.created and unrelated event types', () => {
    expect(
      normalizeStripeFinancialEvent(paymentIntentEvent('payment_intent.created', paymentIntent())),
    ).toMatchObject({ kind: 'ignored', reason: 'IGNORED_EVENT_TYPE' });
    expect(
      normalizeStripeFinancialEvent({
        id: 'evt_2',
        type: 'customer.updated',
        data: { object: { id: 'cus_1', object: 'customer' } },
      }),
    ).toMatchObject({ kind: 'ignored', reason: 'IGNORED_EVENT_TYPE' });
  });

  it('rejects a PaymentIntent event whose object is not payment_intent', () => {
    expect(() =>
      normalizeStripeFinancialEvent(
        paymentIntentEvent('payment_intent.succeeded', {
          id: 'pi_norm_1',
          object: 'charge',
          status: 'succeeded',
          amount: 10000,
          currency: 'usd',
          capture_method: 'automatic',
          amount_capturable: 0,
          amount_received: 10000,
        }),
      ),
    ).toThrow(StripeWebhookNormalizeError);
  });

  it('maps refund snapshots through the existing refund status mapper', () => {
    const normalized = normalizeStripeFinancialEvent({
      id: 'evt_re_1',
      type: 'refund.updated',
      created: 1_725_280_000,
      data: {
        object: {
          id: 're_norm_1',
          object: 'refund',
          status: 'succeeded',
          amount: 4000,
          currency: 'usd',
          payment_intent: 'pi_norm_1',
        },
      },
    });
    expect(normalized.kind).toBe('refund');
    if (normalized.kind !== 'refund') {
      return;
    }
    expect(normalized.state).toBe(REFUND_STATES.SUCCEEDED);
    expect(normalized.amount.amount).toBe(4000n);
    expect(normalized.providerRefund.id).toBe('re_norm_1');
    expect(normalized.providerPayment?.id).toBe('pi_norm_1');
  });

  it('does not reject a structurally compatible api_version that differs from the SDK pin', () => {
    const normalized = normalizeStripeFinancialEvent(
      paymentIntentEvent('payment_intent.succeeded', paymentIntent(), {
        api_version: '2019-12-03',
      }),
    );
    expect(normalized.kind).toBe('payment');
  });
});
