import {
  asCustomerId,
  asOrganizationId,
  asPaymentId,
  asRefundId,
  CAPTURE_METHODS,
  createMoney,
  PAYMENT_METHOD_TYPES,
  PAYMENT_STATES,
  REFUND_STATES,
} from '@fraterunion-payments/payment-core';
import {
  asProviderIdempotencyKey,
  createProviderPaymentMethodReference,
} from '@fraterunion-payments/provider-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StripePaymentProvider } from './stripe-payment-provider.js';

const TEST_SECRET_KEY = process.env.STRIPE_TEST_SECRET_KEY ?? '';
const shouldRun = TEST_SECRET_KEY.startsWith('sk_test_');

const ORG = asOrganizationId('01934567-89ab-7cde-8f01-23456789abcd');
const PAYMENT = asPaymentId('01934567-89ab-7cde-8f01-23456789abce');
const CUSTOMER = asCustomerId('01934567-89ab-7cde-8f01-23456789abcf');
const REFUND = asRefundId('01934567-89ab-7cde-8f01-23456789abd0');

const createdPaymentIntentIds: string[] = [];

describe.skipIf(!shouldRun)('Stripe test-mode integration', () => {
  let provider: StripePaymentProvider;

  beforeAll(() => {
    provider = new StripePaymentProvider({ secretKey: TEST_SECRET_KEY });
  });

  afterAll(async () => {
    await Promise.all(
      createdPaymentIntentIds.map(async (id) => {
        try {
          await provider.cancelPayment({
            organizationId: ORG,
            paymentId: PAYMENT,
            providerPaymentReference: { provider: provider.code, id },
            idempotencyKey: asProviderIdempotencyKey(`cleanup-${id}`),
          });
        } catch {
          // Already captured, canceled, or not cancelable in test mode.
        }
      }),
    );
  });

  it('creates a customer, automatic payment, manual capture, refund, and retrieve', async () => {
    const customer = await provider.createCustomer({
      organizationId: ORG,
      customerReference: CUSTOMER,
      idempotencyKey: asProviderIdempotencyKey(`it-cus-${Date.now()}`),
    });
    expect(customer.providerCustomerReference.provider).toBe('stripe');
    expect(customer.providerCustomerReference.id.startsWith('cus_')).toBe(true);

    const automatic = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1500n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: asProviderIdempotencyKey(`it-auto-${Date.now()}`),
      customer: customer.providerCustomerReference,
      paymentMethod: createProviderPaymentMethodReference({
        provider: 'stripe',
        id: 'pm_card_visa',
        type: PAYMENT_METHOD_TYPES.CARD,
      }),
    });
    createdPaymentIntentIds.push(automatic.providerPaymentReference.id);
    expect(automatic.state).toBe(PAYMENT_STATES.SUCCEEDED);
    expect(automatic.capturedAmount?.amount).toBe(1500n);
    expect(
      JSON.stringify(automatic, (_key, current) =>
        typeof current === 'bigint' ? current.toString() : current,
      ),
    ).not.toMatch(/client_secret/);

    const refunded = await provider.refundPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      refundId: REFUND,
      providerPaymentReference: automatic.providerPaymentReference,
      amount: createMoney(500n, 'USD'),
      idempotencyKey: asProviderIdempotencyKey(`it-refund-${Date.now()}`),
    });
    expect(refunded.state).toBe(REFUND_STATES.SUCCEEDED);

    const manual = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(2000n, 'USD'),
      captureMethod: CAPTURE_METHODS.MANUAL,
      idempotencyKey: asProviderIdempotencyKey(`it-manual-${Date.now()}`),
      paymentMethod: createProviderPaymentMethodReference({
        provider: 'stripe',
        id: 'pm_card_visa',
        type: PAYMENT_METHOD_TYPES.CARD,
      }),
    });
    createdPaymentIntentIds.push(manual.providerPaymentReference.id);
    expect(manual.state).toBe(PAYMENT_STATES.AUTHORIZED);

    const captured = await provider.capturePayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      providerPaymentReference: manual.providerPaymentReference,
      amount: createMoney(1200n, 'USD'),
      idempotencyKey: asProviderIdempotencyKey(`it-capture-${Date.now()}`),
    });
    expect(captured.state).toBe(PAYMENT_STATES.SUCCEEDED);
    expect(captured.capturedAmount?.amount).toBe(1200n);

    const toCancel = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(900n, 'USD'),
      captureMethod: CAPTURE_METHODS.MANUAL,
      idempotencyKey: asProviderIdempotencyKey(`it-cancel-create-${Date.now()}`),
      paymentMethod: createProviderPaymentMethodReference({
        provider: 'stripe',
        id: 'pm_card_visa',
        type: PAYMENT_METHOD_TYPES.CARD,
      }),
    });
    createdPaymentIntentIds.push(toCancel.providerPaymentReference.id);
    const canceled = await provider.cancelPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      providerPaymentReference: toCancel.providerPaymentReference,
      idempotencyKey: asProviderIdempotencyKey(`it-cancel-${Date.now()}`),
    });
    expect(canceled.state).toBe(PAYMENT_STATES.CANCELED);

    const retrieved = await provider.retrievePayment({
      providerPaymentReference: automatic.providerPaymentReference,
    });
    expect(retrieved.providerPaymentReference.id).toBe(automatic.providerPaymentReference.id);
    expect(retrieved.requestedAmount?.amount).toBe(1500n);
  });
});
