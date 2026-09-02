import {
  asCustomerId,
  asOrganizationId,
  asPaymentId,
  asRefundId,
  CAPTURE_METHODS,
  createMoney,
  PAYMENT_FAILURE_CATEGORIES,
  PAYMENT_METHOD_TYPES,
  PAYMENT_STATES,
  REFUND_REASONS,
  REFUND_STATES,
} from '@fraterunion-payments/payment-core';
import {
  asProviderIdempotencyKey,
  createProviderAccountReference,
  createProviderCustomerReference,
  createProviderMetadata,
  createProviderPaymentMethodReference,
  createProviderPaymentReference,
  ProviderAuthenticationError,
  ProviderConfigurationError,
  ProviderMismatchError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from '@fraterunion-payments/provider-contracts';
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { STRIPE_API_VERSION } from './api-version.js';
import { STRIPE_PROVIDER_CAPABILITIES, STRIPE_PROVIDER_CODE } from './constants.js';
import { STRIPE_MAX_SAFE_AMOUNT } from './money.js';
import { StripePaymentProvider } from './stripe-payment-provider.js';
import { createFakeStripeClient } from './test/fake-stripe-client.js';

const ORG = asOrganizationId('01934567-89ab-7cde-8f01-23456789abcd');
const PAYMENT = asPaymentId('01934567-89ab-7cde-8f01-23456789abce');
const CUSTOMER = asCustomerId('01934567-89ab-7cde-8f01-23456789abcf');
const REFUND = asRefundId('01934567-89ab-7cde-8f01-23456789abd0');
const NOW = new Date('2026-09-02T16:00:00.000Z');

function stripeMethod(id = 'pm_card_visa') {
  return createProviderPaymentMethodReference({
    provider: STRIPE_PROVIDER_CODE,
    id,
    type: PAYMENT_METHOD_TYPES.CARD,
  });
}

function createAdapter(fake = createFakeStripeClient()) {
  const provider = new StripePaymentProvider(
    { secretKey: 'sk_test_fake' },
    { client: fake, now: () => NOW },
  );
  return { provider, fake };
}

function assertNoStripeLeak(value: unknown): void {
  const serialized = JSON.stringify(value, (_key, current) =>
    typeof current === 'bigint' ? current.toString() : current,
  );
  expect(serialized).not.toMatch(/client_secret/);
  expect(serialized).not.toMatch(/"object":"payment_intent"/);
  expect(serialized).not.toMatch(/"object":"refund"/);
  expect(serialized).not.toMatch(/"object":"customer"/);
  expect(serialized).not.toMatch(/sk_test_fake/);
  expect(serialized).not.toMatch(/pi_secret_/);
}

describe('StripePaymentProvider', () => {
  it('declares stripe identity, pinned API version, and supported capabilities', () => {
    const { provider } = createAdapter();
    expect(provider.code).toBe('stripe');
    expect(provider.apiVersion).toBe(STRIPE_API_VERSION);
    expect(provider.apiVersion).toBe('2026-08-26.dahlia');
    expect(provider.capabilities).toEqual(STRIPE_PROVIDER_CAPABILITIES);
    expect(provider.capabilities.multipleCapture).toBe(false);
    expect(provider).not.toHaveProperty('secretKey');
  });

  it('rejects empty secret keys and unsupported API versions without logging secrets', () => {
    expect(() => new StripePaymentProvider({ secretKey: '   ' })).toThrow(
      ProviderConfigurationError,
    );
    expect(
      () =>
        new StripePaymentProvider({
          secretKey: 'sk_test_fake',
          apiVersion: '2010-01-01' as typeof STRIPE_API_VERSION,
        }),
    ).toThrow(/Unsupported Stripe API version/);
  });

  it('rejects provider-owned references from another provider', async () => {
    const { provider, fake } = createAdapter();
    await expect(
      provider.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(1000n, 'USD'),
        captureMethod: CAPTURE_METHODS.AUTOMATIC,
        idempotencyKey: asProviderIdempotencyKey('mismatch-pm'),
        paymentMethod: createProviderPaymentMethodReference({
          provider: 'adyen',
          id: 'pm_other',
          type: PAYMENT_METHOD_TYPES.CARD,
        }),
      }),
    ).rejects.toBeInstanceOf(ProviderMismatchError);
    expect(fake.lastCreatePaymentIntentParams).toHaveLength(0);

    await expect(
      provider.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(1000n, 'USD'),
        captureMethod: CAPTURE_METHODS.AUTOMATIC,
        idempotencyKey: asProviderIdempotencyKey('mismatch-customer'),
        customer: createProviderCustomerReference({ provider: 'moneris', id: 'cus_other' }),
      }),
    ).rejects.toBeInstanceOf(ProviderMismatchError);
  });

  it('maps customer create fields and forwards the idempotency key', async () => {
    const { provider, fake } = createAdapter();
    const result = await provider.createCustomer({
      organizationId: ORG,
      customerReference: CUSTOMER,
      idempotencyKey: asProviderIdempotencyKey('cus-key-1'),
      email: 'member@example.com',
      name: 'Member',
      metadata: createProviderMetadata({ chapter: 'alpha' }),
    });
    expect(result.providerCustomerReference).toEqual({
      provider: 'stripe',
      id: 'cus_1',
    });
    expect(result.observedAt).toEqual(NOW);
    expect(fake.lastCreateCustomerParams[0]).toEqual({
      email: 'member@example.com',
      name: 'Member',
      metadata: { chapter: 'alpha' },
    });
    expect(fake.lastOptions.createCustomer?.idempotencyKey).toBe('cus-key-1');
    assertNoStripeLeak(result);
  });

  it('does not require email or name for customer creation', async () => {
    const { provider, fake } = createAdapter();
    await provider.createCustomer({
      organizationId: ORG,
      customerReference: CUSTOMER,
      idempotencyKey: asProviderIdempotencyKey('cus-key-2'),
    });
    expect(fake.lastCreateCustomerParams[0]).toEqual({});
  });

  it('creates an automatic-capture payment and confirms a Stripe payment method', async () => {
    const { provider, fake } = createAdapter();
    const result = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(2500n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: asProviderIdempotencyKey('pay-auto'),
      paymentMethod: stripeMethod(),
      metadata: createProviderMetadata({ order: '42' }),
    });
    expect(result.state).toBe(PAYMENT_STATES.SUCCEEDED);
    expect(result.capturedAmount).toEqual(createMoney(2500n, 'USD'));
    expect(result.authorizedAmount).toEqual(createMoney(2500n, 'USD'));
    expect(result.observedAt).toEqual(NOW);
    expect(fake.lastCreatePaymentIntentParams[0]).toMatchObject({
      amount: 2500,
      currency: 'usd',
      capture_method: 'automatic',
      payment_method: 'pm_card_visa',
      confirm: true,
      off_session: true,
      metadata: { order: '42' },
    });
    expect(fake.lastOptions.createPaymentIntent?.idempotencyKey).toBe('pay-auto');
    assertNoStripeLeak(result);
  });

  it('creates a manual-capture payment as AUTHORIZED without exposing capture_method', async () => {
    const { provider, fake } = createAdapter();
    const result = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(5000n, 'EUR'),
      captureMethod: CAPTURE_METHODS.MANUAL,
      idempotencyKey: asProviderIdempotencyKey('pay-manual'),
      paymentMethod: stripeMethod(),
    });
    expect(result.state).toBe(PAYMENT_STATES.AUTHORIZED);
    expect(result.authorizedAmount).toEqual(createMoney(5000n, 'EUR'));
    expect(result.capturedAmount).toBeUndefined();
    expect(fake.lastCreatePaymentIntentParams[0]?.capture_method).toBe('manual');
    expect(
      JSON.stringify(result, (_key, current) =>
        typeof current === 'bigint' ? current.toString() : current,
      ),
    ).not.toMatch(/capture_method/);
  });

  it('creates an unconfirmed PaymentIntent when no payment method is supplied', async () => {
    const { provider, fake } = createAdapter();
    const result = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1000n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: asProviderIdempotencyKey('pay-no-pm'),
    });
    expect(result.state).toBe(PAYMENT_STATES.REQUIRES_PAYMENT_METHOD);
    expect(fake.lastCreatePaymentIntentParams[0]?.confirm).toBeUndefined();
    expect(fake.lastCreatePaymentIntentParams[0]?.payment_method).toBeUndefined();
  });

  it('does not auto-create a Stripe customer during createPayment', async () => {
    const { provider, fake } = createAdapter();
    await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1000n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: asProviderIdempotencyKey('pay-with-customer'),
      customer: createProviderCustomerReference({ provider: 'stripe', id: 'cus_existing' }),
      paymentMethod: stripeMethod(),
    });
    expect(fake.lastCreateCustomerParams).toHaveLength(0);
    expect(fake.lastCreatePaymentIntentParams[0]?.customer).toBe('cus_existing');
  });

  it('forwards the exact application idempotency key and does not invent another', async () => {
    const { provider, fake } = createAdapter();
    const key = asProviderIdempotencyKey('exact-forward-key');
    const first = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1000n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: key,
      paymentMethod: stripeMethod(),
    });
    const second = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1000n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: key,
      paymentMethod: stripeMethod(),
    });
    expect(second.providerPaymentReference.id).toBe(first.providerPaymentReference.id);
    expect(fake.lastOptions.createPaymentIntent?.idempotencyKey).toBe('exact-forward-key');
    expect(fake.lastCreatePaymentIntentParams).toHaveLength(2);
  });

  it('executes connected-account requests with stripeAccount and does not leak that field', async () => {
    const { provider, fake } = createAdapter();
    const account = createProviderAccountReference({ provider: 'stripe', id: 'acct_connected' });
    const result = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1000n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: asProviderIdempotencyKey('connect-create'),
      paymentMethod: stripeMethod(),
      providerAccount: account,
    });
    expect(fake.lastOptions.createPaymentIntent?.stripeAccount).toBe('acct_connected');
    expect(
      JSON.stringify(result, (_key, current) =>
        typeof current === 'bigint' ? current.toString() : current,
      ),
    ).not.toMatch(/stripeAccount|acct_connected/);
  });

  it('normalizes requires_action without copying next_action or client secrets', async () => {
    const { provider } = createAdapter();
    const result = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1000n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: asProviderIdempotencyKey('action'),
      paymentMethod: stripeMethod('pm_requires_action'),
    });
    expect(result.state).toBe(PAYMENT_STATES.REQUIRES_ACTION);
    expect(result.actionRequirement).toEqual({ type: 'REDIRECT' });
    assertNoStripeLeak(result);
    expect(
      JSON.stringify(result, (_key, current) =>
        typeof current === 'bigint' ? current.toString() : current,
      ),
    ).not.toMatch(/redirect_to_url|next_action/);
  });

  it('rejects amounts that cannot be converted to a safe Stripe integer', async () => {
    const { provider, fake } = createAdapter();
    await expect(
      provider.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(STRIPE_MAX_SAFE_AMOUNT + 1n, 'USD'),
        captureMethod: CAPTURE_METHODS.AUTOMATIC,
        idempotencyKey: asProviderIdempotencyKey('overflow'),
        paymentMethod: stripeMethod(),
      }),
    ).rejects.toThrow(/safe integer range/);
    expect(fake.lastCreatePaymentIntentParams).toHaveLength(0);
  });

  it('captures full and partial authorized amounts', async () => {
    const { provider, fake } = createAdapter();
    const created = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(5000n, 'USD'),
      captureMethod: CAPTURE_METHODS.MANUAL,
      idempotencyKey: asProviderIdempotencyKey('cap-create'),
      paymentMethod: stripeMethod(),
    });
    const captured = await provider.capturePayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      providerPaymentReference: created.providerPaymentReference,
      amount: createMoney(2000n, 'USD'),
      idempotencyKey: asProviderIdempotencyKey('cap-partial'),
    });
    expect(captured.state).toBe(PAYMENT_STATES.SUCCEEDED);
    expect(captured.capturedAmount).toEqual(createMoney(2000n, 'USD'));
    expect(fake.lastCaptureParams[0]?.params).toEqual({ amount_to_capture: 2000 });
    expect(fake.lastOptions.capturePaymentIntent?.idempotencyKey).toBe('cap-partial');
  });

  it('cancels an authorized payment', async () => {
    const { provider, fake } = createAdapter();
    const created = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(5000n, 'USD'),
      captureMethod: CAPTURE_METHODS.MANUAL,
      idempotencyKey: asProviderIdempotencyKey('cancel-create'),
      paymentMethod: stripeMethod(),
    });
    const canceled = await provider.cancelPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      providerPaymentReference: created.providerPaymentReference,
      idempotencyKey: asProviderIdempotencyKey('cancel-key'),
    });
    expect(canceled.state).toBe(PAYMENT_STATES.CANCELED);
    expect(fake.lastOptions.cancelPaymentIntent?.idempotencyKey).toBe('cancel-key');
  });

  it('refunds a captured payment and maps canonical reasons', async () => {
    const { provider, fake } = createAdapter();
    const created = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(3000n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: asProviderIdempotencyKey('refund-create'),
      paymentMethod: stripeMethod(),
    });
    const duplicate = await provider.refundPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      refundId: REFUND,
      providerPaymentReference: created.providerPaymentReference,
      amount: createMoney(1000n, 'USD'),
      reason: REFUND_REASONS.DUPLICATE,
      idempotencyKey: asProviderIdempotencyKey('refund-dup'),
    });
    expect(duplicate.state).toBe(REFUND_STATES.SUCCEEDED);
    expect(duplicate.providerRefundReference.provider).toBe('stripe');
    expect(fake.lastRefundParams[0]).toMatchObject({
      payment_intent: created.providerPaymentReference.id,
      amount: 1000,
      reason: 'duplicate',
    });

    await provider.refundPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      refundId: REFUND,
      providerPaymentReference: created.providerPaymentReference,
      amount: createMoney(500n, 'USD'),
      reason: REFUND_REASONS.CUSTOMER_REQUEST,
      idempotencyKey: asProviderIdempotencyKey('refund-customer'),
    });
    expect(fake.lastRefundParams[1]?.reason).toBeUndefined();
    expect(fake.lastOptions.refundCreate?.idempotencyKey).toBe('refund-customer');
    assertNoStripeLeak(duplicate);
  });

  it('retrieves a payment as a normalized observation', async () => {
    const { provider } = createAdapter();
    const created = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1800n, 'EUR'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: asProviderIdempotencyKey('retrieve-create'),
      paymentMethod: stripeMethod(),
    });
    const retrieved = await provider.retrievePayment({
      providerPaymentReference: created.providerPaymentReference,
    });
    expect(retrieved.providerPaymentReference).toEqual(created.providerPaymentReference);
    expect(retrieved.requestedAmount).toEqual(createMoney(1800n, 'EUR'));
    expect(retrieved.state).toBe(PAYMENT_STATES.SUCCEEDED);
    expect(retrieved.observedAt).toEqual(NOW);
    assertNoStripeLeak(retrieved);
  });

  it('maps card declines to PaymentFailure observations, not infrastructure errors', async () => {
    const { provider } = createAdapter();
    const declined = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1000n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: asProviderIdempotencyKey('declined'),
      paymentMethod: stripeMethod('pm_card_chargeDeclined'),
    });
    expect(declined.state).toBe(PAYMENT_STATES.REQUIRES_PAYMENT_METHOD);
    expect(declined.failure).toMatchObject({
      category: PAYMENT_FAILURE_CATEGORIES.DECLINED,
      code: 'generic_decline',
    });

    const funds = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1000n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: asProviderIdempotencyKey('nsf'),
      paymentMethod: stripeMethod('pm_card_visa_chargeDeclinedInsufficientFunds'),
    });
    expect(funds.failure).toMatchObject({
      category: PAYMENT_FAILURE_CATEGORIES.INSUFFICIENT_FUNDS,
      code: 'insufficient_funds',
    });
  });

  it('maps authentication, rate limit, timeout, and unavailable errors', async () => {
    const { provider, fake } = createAdapter();
    fake.failNext(
      new Stripe.errors.StripeAuthenticationError({
        message: 'Invalid API Key provided: sk_test_xxx',
        statusCode: 401,
      }),
    );
    await expect(
      provider.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(1000n, 'USD'),
        captureMethod: CAPTURE_METHODS.AUTOMATIC,
        idempotencyKey: asProviderIdempotencyKey('auth-fail'),
      }),
    ).rejects.toBeInstanceOf(ProviderAuthenticationError);

    fake.failNext(
      new Stripe.errors.StripeRateLimitError({
        message: 'Too many requests',
        statusCode: 429,
        headers: { 'retry-after': '5' },
      }),
    );
    await expect(
      provider.createCustomer({
        organizationId: ORG,
        customerReference: CUSTOMER,
        idempotencyKey: asProviderIdempotencyKey('rate'),
      }),
    ).rejects.toMatchObject({
      name: ProviderRateLimitError.name,
      retryAfterMs: 5000,
    });

    fake.failNext(new Stripe.errors.StripeConnectionError({ message: 'Request timed out' }));
    await expect(
      provider.retrievePayment({
        providerPaymentReference: createProviderPaymentReference({
          provider: 'stripe',
          id: 'pi_missing',
        }),
      }),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);

    fake.failNext(new TypeError('network down'));
    await expect(
      provider.retrievePayment({
        providerPaymentReference: createProviderPaymentReference({
          provider: 'stripe',
          id: 'pi_missing',
        }),
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
