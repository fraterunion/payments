import { ProviderConfigurationError } from '@fraterunion-payments/provider-contracts';
import { describe, expect, it } from 'vitest';
import {
  createStripeWebhookTestSignature,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  verifyStripeWebhook,
} from './webhook.js';
import { StripeWebhookPayloadError, StripeWebhookSignatureError } from './webhook-errors.js';
import { assertStripeWebhookSecret } from './webhook-secret.js';

const SECRET = 'whsec_test_fup_webhook_not_for_production';
const PREVIOUS_SECRET = 'whsec_test_fup_webhook_previous_secret';

function snapshotEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt_fup_test_1',
    object: 'event',
    type: 'payment_intent.succeeded',
    api_version: '2026-08-26.dahlia',
    livemode: false,
    created: 1_725_280_000,
    account: 'acct_connected1',
    data: { object: { id: 'pi_test', object: 'payment_intent', status: 'succeeded' } },
    ...overrides,
  };
}

function signed(payload: string, secret = SECRET, timestamp?: number): string {
  return createStripeWebhookTestSignature({
    payload,
    secret,
    ...(timestamp !== undefined ? { timestamp } : {}),
  });
}

describe('verifyStripeWebhook', () => {
  it('accepts a valid signed snapshot event and omits Stripe Event types', () => {
    const payload = JSON.stringify(snapshotEvent());
    const verified = verifyStripeWebhook({
      rawBody: payload,
      signature: signed(payload),
      secrets: [SECRET],
    });
    expect(verified.eventId).toBe('evt_fup_test_1');
    expect(verified.eventType).toBe('payment_intent.succeeded');
    expect(verified.accountId).toBe('acct_connected1');
    expect(verified.apiVersion).toBe('2026-08-26.dahlia');
    expect(verified.livemode).toBe(false);
    expect(verified.createdAt?.toISOString()).toBe('2024-09-02T12:26:40.000Z');
    expect(verified.payload['id']).toBe('evt_fup_test_1');
    expect(JSON.stringify(verified)).not.toMatch(/Stripe\.Event|constructEvent/);
    expect(verified.payload).not.toHaveProperty('lastResponse');
  });

  it('rejects a missing or invalid signature without treating JSON as verified', () => {
    const payload = JSON.stringify(snapshotEvent());
    expect(() =>
      verifyStripeWebhook({ rawBody: payload, signature: undefined, secrets: [SECRET] }),
    ).toThrow(StripeWebhookSignatureError);
    expect(() =>
      verifyStripeWebhook({ rawBody: payload, signature: 't=1,v1=deadbeef', secrets: [SECRET] }),
    ).toThrow(StripeWebhookSignatureError);
  });

  it('rejects reconstructed JSON that is semantically equal but not the signed bytes', () => {
    const original =
      '{"id":"evt_fup_test_1","object":"event","type":"payment_intent.succeeded","api_version":"2026-08-26.dahlia","livemode":false,"created":1725280000,"data":{"object":{"id":"pi_test"}}}';
    const signature = signed(original);
    const reconstructed = JSON.stringify(JSON.parse(original), null, 2);
    expect(reconstructed).not.toBe(original);
    expect(JSON.parse(reconstructed)).toEqual(JSON.parse(original));
    expect(() =>
      verifyStripeWebhook({ rawBody: reconstructed, signature, secrets: [SECRET] }),
    ).toThrow(StripeWebhookSignatureError);
    const verified = verifyStripeWebhook({
      rawBody: original,
      signature,
      secrets: [SECRET],
    });
    expect(verified.eventId).toBe('evt_fup_test_1');
  });

  it('rejects a tampered body and a stale timestamp', () => {
    const payload = JSON.stringify(snapshotEvent());
    const signature = signed(payload);
    expect(() =>
      verifyStripeWebhook({
        rawBody: payload.replace('succeeded', 'canceled'),
        signature,
        secrets: [SECRET],
      }),
    ).toThrow(StripeWebhookSignatureError);

    const stale = Math.floor(Date.now() / 1000) - (STRIPE_WEBHOOK_TOLERANCE_SECONDS + 60);
    expect(() =>
      verifyStripeWebhook({
        rawBody: payload,
        signature: signed(payload, SECRET, stale),
        secrets: [SECRET],
      }),
    ).toThrow(StripeWebhookSignatureError);
  });

  it('accepts the previous signing secret during rotation', () => {
    const payload = JSON.stringify(snapshotEvent({ id: 'evt_fup_test_rotate' }));
    const verified = verifyStripeWebhook({
      rawBody: payload,
      signature: signed(payload, PREVIOUS_SECRET),
      secrets: [SECRET, PREVIOUS_SECRET],
    });
    expect(verified.eventId).toBe('evt_fup_test_rotate');
  });

  it('preserves livemode and API version and extracts no account for platform events', () => {
    const payload = JSON.stringify(
      snapshotEvent({
        account: undefined,
        livemode: true,
        api_version: '2024-06-20',
      }),
    );
    const verified = verifyStripeWebhook({
      rawBody: payload,
      signature: signed(payload),
      secrets: [SECRET],
    });
    expect(verified.accountId).toBeUndefined();
    expect(verified.livemode).toBe(true);
    expect(verified.apiVersion).toBe('2024-06-20');
  });

  it('rejects malformed JSON after a cryptographic envelope that cannot yield an event', () => {
    expect(() =>
      verifyStripeWebhook({
        rawBody: '{not-json',
        signature: signed('{not-json'),
        secrets: [SECRET],
      }),
    ).toThrow(StripeWebhookPayloadError);
  });

  it('rejects a non-object event and control characters in identifiers', () => {
    const arrayPayload = '[1]';
    expect(() =>
      verifyStripeWebhook({
        rawBody: arrayPayload,
        signature: signed(arrayPayload),
        secrets: [SECRET],
      }),
    ).toThrow(StripeWebhookPayloadError);

    const badId = JSON.stringify(snapshotEvent({ id: 'evt_\u0001bad' }));
    expect(() =>
      verifyStripeWebhook({
        rawBody: badId,
        signature: signed(badId),
        secrets: [SECRET],
      }),
    ).toThrow(StripeWebhookPayloadError);
  });
});

describe('assertStripeWebhookSecret', () => {
  it('accepts a whsec_ secret and rejects obvious misconfiguration without echoing it', () => {
    expect(assertStripeWebhookSecret(SECRET)).toBe(SECRET);
    expect(() => assertStripeWebhookSecret('sk_test_not_a_webhook_secret')).toThrow(
      ProviderConfigurationError,
    );
    try {
      assertStripeWebhookSecret('sk_test_not_a_webhook_secret');
      throw new Error('expected throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('sk_test_not_a_webhook_secret');
    }
  });
});
