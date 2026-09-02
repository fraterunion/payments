import {
  asCustomerId,
  asOrganizationId,
  asPaymentId,
  asRefundId,
  CAPTURE_METHODS,
  createMoney,
  createPaymentFailure,
  PAYMENT_FAILURE_CATEGORIES,
  PAYMENT_STATES,
  REFUND_STATES,
} from '@fraterunion-payments/payment-core';
import { describe, expect, it } from 'vitest';
import { UnsupportedProviderCapabilityError } from '../errors.js';
import { asProviderIdempotencyKey } from '../idempotency.js';
import { createProviderPaymentObservation } from '../operations.js';
import {
  createProviderAccountReference,
  createProviderPaymentMethodReference,
  createProviderPaymentReference,
} from '../references.js';
import { createFakePaymentProvider } from './fake-provider.js';

const ORG = asOrganizationId('01934567-89ab-7cde-8f01-23456789abcd');
const PAYMENT = asPaymentId('01934567-89ab-7cde-8f01-23456789abce');
const CUSTOMER = asCustomerId('01934567-89ab-7cde-8f01-23456789abcf');
const REFUND = asRefundId('01934567-89ab-7cde-8f01-23456789abd0');

describe('fake provider contract ergonomics', () => {
  it('executes create customer, payment, capture, cancel, refund, and retrieve', async () => {
    const provider = createFakePaymentProvider();
    const customer = await provider.createCustomer({
      organizationId: ORG,
      customerReference: CUSTOMER,
      idempotencyKey: asProviderIdempotencyKey('cust-1'),
    });
    expect(customer.providerCustomerReference.provider).toBe('example');

    const created = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(4000n, 'USD'),
      captureMethod: CAPTURE_METHODS.MANUAL,
      idempotencyKey: asProviderIdempotencyKey('pay-1'),
      customer: customer.providerCustomerReference,
      paymentMethod: createProviderPaymentMethodReference({
        provider: 'example',
        id: 'pm_tok_1',
        type: 'CARD',
      }),
    });
    expect(created.state).toBe(PAYMENT_STATES.AUTHORIZING);

    const captured = await provider.capturePayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      providerPaymentReference: created.providerPaymentReference,
      amount: createMoney(2500n, 'USD'),
      idempotencyKey: asProviderIdempotencyKey('cap-1'),
    });
    expect(captured.state).toBe(PAYMENT_STATES.SUCCEEDED);
    expect(captured.capturedAmount?.amount).toBe(2500n);

    const refunded = await provider.refundPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      refundId: REFUND,
      providerPaymentReference: created.providerPaymentReference,
      amount: createMoney(500n, 'USD'),
      idempotencyKey: asProviderIdempotencyKey('ref-1'),
    });
    expect(refunded.state).toBe(REFUND_STATES.SUCCEEDED);

    const retrieved = await provider.retrievePayment({
      providerPaymentReference: created.providerPaymentReference,
    });
    expect(retrieved.refundedAmount?.amount).toBe(500n);
    expect(retrieved.requestedAmount?.amount).toBe(4000n);

    const toCancel = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1000n, 'USD'),
      captureMethod: CAPTURE_METHODS.MANUAL,
      idempotencyKey: asProviderIdempotencyKey('pay-cancel'),
    });
    const canceled = await provider.cancelPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      providerPaymentReference: toCancel.providerPaymentReference,
      idempotencyKey: asProviderIdempotencyKey('cancel-1'),
    });
    expect(canceled.state).toBe(PAYMENT_STATES.CANCELED);
  });

  it('propagates idempotency keys and returns the original result', async () => {
    const provider = createFakePaymentProvider();
    const key = asProviderIdempotencyKey('same-key');
    const first = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1200n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: key,
    });
    const second = await provider.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1200n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: key,
    });
    expect(second).toBe(first);
    expect(provider.lastIdempotencyKeyByOperation.get('createPayment')).toBe(key);
  });

  it('rejects a payment-method or account owned by another provider', async () => {
    const provider = createFakePaymentProvider({ code: 'example' });
    await expect(
      provider.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(1000n, 'USD'),
        captureMethod: CAPTURE_METHODS.AUTOMATIC,
        idempotencyKey: asProviderIdempotencyKey('mismatch'),
        paymentMethod: createProviderPaymentMethodReference({
          provider: 'acme',
          id: 'pm_foreign',
          type: 'CARD',
        }),
      }),
    ).rejects.toThrow(/Provider mismatch/);

    await expect(
      provider.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(1000n, 'USD'),
        captureMethod: CAPTURE_METHODS.AUTOMATIC,
        idempotencyKey: asProviderIdempotencyKey('acct-mismatch'),
        providerAccount: createProviderAccountReference({ provider: 'acme', id: 'acct_1' }),
      }),
    ).rejects.toThrow(/Provider mismatch/);
  });

  it('enforces capability flags before mutating', async () => {
    const limited = createFakePaymentProvider({
      capabilities: {
        manualCapture: false,
        partialCapture: false,
        multipleCapture: false,
        fullRefund: false,
        partialRefund: false,
        customerVault: false,
      },
    });
    await expect(
      limited.createCustomer({
        organizationId: ORG,
        customerReference: CUSTOMER,
        idempotencyKey: asProviderIdempotencyKey('no-vault'),
      }),
    ).rejects.toBeInstanceOf(UnsupportedProviderCapabilityError);

    await expect(
      limited.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(1000n, 'USD'),
        captureMethod: CAPTURE_METHODS.MANUAL,
        idempotencyKey: asProviderIdempotencyKey('no-manual'),
      }),
    ).rejects.toBeInstanceOf(UnsupportedProviderCapabilityError);

    const created = await limited.createPayment({
      organizationId: ORG,
      paymentId: PAYMENT,
      amount: createMoney(1000n, 'USD'),
      captureMethod: CAPTURE_METHODS.AUTOMATIC,
      idempotencyKey: asProviderIdempotencyKey('auto-ok'),
    });
    await expect(
      limited.capturePayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        providerPaymentReference: created.providerPaymentReference,
        amount: createMoney(400n, 'USD'),
        idempotencyKey: asProviderIdempotencyKey('no-partial'),
      }),
    ).rejects.toBeInstanceOf(UnsupportedProviderCapabilityError);
  });

  it('keeps observations immutable and distinct from raw exceptions', () => {
    const observation = createProviderPaymentObservation({
      providerPaymentReference: createProviderPaymentReference({
        provider: 'example',
        id: 'pay_obs',
      }),
      state: PAYMENT_STATES.FAILED,
      failure: createPaymentFailure({
        category: PAYMENT_FAILURE_CATEGORIES.DECLINED,
        message: 'Declined.',
        retryable: false,
      }),
    });
    expect(Object.isFrozen(observation)).toBe(true);
    expect(observation.failure?.category).toBe('DECLINED');
  });
});
