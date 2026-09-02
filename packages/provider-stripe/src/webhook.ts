import Stripe from 'stripe';
import { ProviderConfigurationError } from '@fraterunion-payments/provider-contracts';
import { assertStripeWebhookSecret } from './webhook-secret.js';
import { StripeWebhookPayloadError, StripeWebhookSignatureError } from './webhook-errors.js';
import type { VerifiedStripeWebhook, VerifyStripeWebhookInput } from './webhook-types.js';

/** Official Stripe default timestamp tolerance (seconds). */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

const EVENT_ID_MAX_LENGTH = 256;
const EVENT_TYPE_MAX_LENGTH = 128;
const API_VERSION_MAX_LENGTH = 64;
const ACCOUNT_ID_MAX_LENGTH = 255;

/**
 * Verifies a Stripe-signed webhook against the exact raw body.
 * Uses Stripe's official constructEvent + timestamp tolerance.
 * Output is a plain JSON envelope — never a Stripe SDK Event.
 */
export function verifyStripeWebhook(input: VerifyStripeWebhookInput): VerifiedStripeWebhook {
  if (input.signature === undefined || input.signature.trim().length === 0) {
    throw new StripeWebhookSignatureError();
  }
  if (input.secrets.length === 0) {
    throw new ProviderConfigurationError('Stripe webhook signing secret is required.');
  }

  const rawBody = toRawBody(input.rawBody);
  const secrets = input.secrets.map((secret) => assertStripeWebhookSecret(secret));
  let lastSignatureError: unknown;
  let verified = false;

  for (const secret of secrets) {
    try {
      Stripe.webhooks.constructEvent(
        rawBody,
        input.signature,
        secret,
        STRIPE_WEBHOOK_TOLERANCE_SECONDS,
      );
      verified = true;
      break;
    } catch (error) {
      if (isStripeSignatureError(error)) {
        lastSignatureError = error;
        continue;
      }
      throw new StripeWebhookPayloadError();
    }
  }

  if (!verified) {
    void lastSignatureError;
    throw new StripeWebhookSignatureError();
  }

  return extractVerifiedEnvelope(rawBody);
}

/**
 * Stripe SDK test helper. Used by adapter and API tests only.
 * Not a production signing path.
 */
export function createStripeWebhookTestSignature(input: {
  readonly payload: string;
  readonly secret: string;
  readonly timestamp?: number;
}): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload: input.payload,
    secret: assertStripeWebhookSecret(input.secret),
    ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
  });
}

function toRawBody(rawBody: Buffer | string): string {
  if (typeof rawBody === 'string') {
    if (rawBody.length === 0) {
      throw new StripeWebhookPayloadError();
    }
    return rawBody;
  }
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    throw new StripeWebhookPayloadError();
  }
  return rawBody.toString('utf8');
}

function extractVerifiedEnvelope(rawBody: string): VerifiedStripeWebhook {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new StripeWebhookPayloadError();
  }
  if (!isPlainObject(parsed)) {
    throw new StripeWebhookPayloadError();
  }

  const eventId = requireBoundedToken(parsed['id'], EVENT_ID_MAX_LENGTH);
  const eventType = requireBoundedToken(parsed['type'], EVENT_TYPE_MAX_LENGTH);
  const livemode = parsed['livemode'];
  if (typeof livemode !== 'boolean') {
    throw new StripeWebhookPayloadError();
  }

  const accountId = optionalBoundedToken(parsed['account'], ACCOUNT_ID_MAX_LENGTH);
  const apiVersion = optionalBoundedToken(parsed['api_version'], API_VERSION_MAX_LENGTH);
  const createdAt = optionalCreatedAt(parsed['created']);

  return {
    eventId,
    eventType,
    livemode,
    payload: parsed,
    ...(accountId !== undefined ? { accountId } : {}),
    ...(apiVersion !== undefined ? { apiVersion } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
  };
}

function requireBoundedToken(value: unknown, maxLength: number): string {
  const token = optionalBoundedToken(value, maxLength);
  if (token === undefined) {
    throw new StripeWebhookPayloadError();
  }
  return token;
}

function optionalBoundedToken(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new StripeWebhookPayloadError();
  }
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      throw new StripeWebhookPayloadError();
    }
  }
  return value;
}

function optionalCreatedAt(value: unknown): Date | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new StripeWebhookPayloadError();
  }
  return new Date(value * 1000);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStripeSignatureError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: string }).type === 'StripeSignatureVerificationError'
  );
}
