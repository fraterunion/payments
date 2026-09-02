import {
  asCustomerId,
  asOrganizationId,
  asPaymentId,
  asRefundId,
  CAPTURE_METHODS,
  createMoney,
  PAYMENT_STATES,
} from '@fraterunion-payments/payment-core';
import { describe, expect, it } from 'vitest';
import { UnsupportedProviderCapabilityError } from '../errors.js';
import { asProviderIdempotencyKey } from '../idempotency.js';
import { asPaymentProviderCode } from '../provider-code.js';
import type { PaymentProvider } from '../provider.js';
import { createProviderPaymentMethodReference } from '../references.js';

const ORG = asOrganizationId('01934567-89ab-7cde-8f01-23456789abcd');
const PAYMENT = asPaymentId('01934567-89ab-7cde-8f01-23456789abce');
const CUSTOMER = asCustomerId('01934567-89ab-7cde-8f01-23456789abcf');
const REFUND = asRefundId('01934567-89ab-7cde-8f01-23456789abd0');

export type PaymentProviderContractTestOptions = {
  readonly createProvider: () => PaymentProvider;
};

/**
 * Structural contract suite for future adapters. Does not perform network I/O.
 * Call from a Vitest file: `runPaymentProviderContractTests({ createProvider })`.
 */
export function runPaymentProviderContractTests(options: PaymentProviderContractTestOptions): void {
  describe(`PaymentProvider contract (${options.createProvider().code})`, () => {
    it('exposes a validated provider code and capability object', () => {
      const provider = options.createProvider();
      expect(asPaymentProviderCode(provider.code)).toBe(provider.code);
      expect(typeof provider.capabilities.manualCapture).toBe('boolean');
      expect(typeof provider.capabilities.partialCapture).toBe('boolean');
      expect(typeof provider.capabilities.multipleCapture).toBe('boolean');
      expect(typeof provider.capabilities.fullRefund).toBe('boolean');
      expect(typeof provider.capabilities.partialRefund).toBe('boolean');
      expect(typeof provider.capabilities.customerVault).toBe('boolean');
    });

    it('returns normalized createPayment observations with provider-owned references', async () => {
      const provider = options.createProvider();
      const result = await provider.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(2500n, 'USD'),
        captureMethod: CAPTURE_METHODS.AUTOMATIC,
        idempotencyKey: asProviderIdempotencyKey('create-payment-1'),
        paymentMethod: createProviderPaymentMethodReference({
          provider: provider.code,
          id: 'pm_tok_1',
          type: 'CARD',
        }),
      });
      expect(result.providerPaymentReference.provider).toBe(provider.code);
      expect(result.providerPaymentReference.id.length).toBeGreaterThan(0);
      expect(result.observedAt).toBeInstanceOf(Date);
      expect(Object.values(PAYMENT_STATES)).toContain(result.state);
    });

    it('propagates the application idempotency key on mutating operations', async () => {
      const provider = options.createProvider();
      const key = asProviderIdempotencyKey('stable-create-key');
      const first = await provider.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(1000n, 'USD'),
        captureMethod: CAPTURE_METHODS.AUTOMATIC,
        idempotencyKey: key,
      });
      const second = await provider.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(1000n, 'USD'),
        captureMethod: CAPTURE_METHODS.AUTOMATIC,
        idempotencyKey: key,
      });
      expect(second.providerPaymentReference.id).toBe(first.providerPaymentReference.id);
    });

    it('retrieves a previously created payment as a normalized observation', async () => {
      const provider = options.createProvider();
      const created = await provider.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(1800n, 'EUR'),
        captureMethod: CAPTURE_METHODS.AUTOMATIC,
        idempotencyKey: asProviderIdempotencyKey('retrieve-create'),
      });
      const retrieved = await provider.retrievePayment({
        providerPaymentReference: created.providerPaymentReference,
      });
      expect(retrieved.providerPaymentReference).toEqual(created.providerPaymentReference);
      expect(retrieved.observedAt).toBeInstanceOf(Date);
    });

    it('creates a customer only when customerVault is advertised', async () => {
      const provider = options.createProvider();
      const attempt = provider.createCustomer({
        organizationId: ORG,
        customerReference: CUSTOMER,
        idempotencyKey: asProviderIdempotencyKey('create-customer-1'),
      });
      if (provider.capabilities.customerVault) {
        const result = await attempt;
        expect(result.providerCustomerReference.provider).toBe(provider.code);
      } else {
        await expect(attempt).rejects.toBeInstanceOf(UnsupportedProviderCapabilityError);
      }
    });

    it('captures, cancels, and refunds according to advertised capabilities', async () => {
      const provider = options.createProvider();
      const created = await provider.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(5000n, 'USD'),
        captureMethod: provider.capabilities.manualCapture
          ? CAPTURE_METHODS.MANUAL
          : CAPTURE_METHODS.AUTOMATIC,
        idempotencyKey: asProviderIdempotencyKey('capability-create'),
      });

      if (provider.capabilities.manualCapture) {
        const canceled = await provider.createPayment({
          organizationId: ORG,
          paymentId: PAYMENT,
          amount: createMoney(5000n, 'USD'),
          captureMethod: CAPTURE_METHODS.MANUAL,
          idempotencyKey: asProviderIdempotencyKey('capability-cancel-create'),
        });
        const cancelResult = await provider.cancelPayment({
          organizationId: ORG,
          paymentId: PAYMENT,
          providerPaymentReference: canceled.providerPaymentReference,
          idempotencyKey: asProviderIdempotencyKey('capability-cancel'),
        });
        expect(cancelResult.state).toBe(PAYMENT_STATES.CANCELED);
      } else {
        await expect(
          provider.cancelPayment({
            organizationId: ORG,
            paymentId: PAYMENT,
            providerPaymentReference: created.providerPaymentReference,
            idempotencyKey: asProviderIdempotencyKey('capability-cancel-unsupported'),
          }),
        ).rejects.toBeInstanceOf(UnsupportedProviderCapabilityError);
      }

      if (provider.capabilities.partialCapture) {
        const captured = await provider.capturePayment({
          organizationId: ORG,
          paymentId: PAYMENT,
          providerPaymentReference: created.providerPaymentReference,
          amount: createMoney(2000n, 'USD'),
          idempotencyKey: asProviderIdempotencyKey('capability-partial-capture'),
        });
        expect(captured.capturedAmount?.amount).toBe(2000n);
      } else {
        await expect(
          provider.capturePayment({
            organizationId: ORG,
            paymentId: PAYMENT,
            providerPaymentReference: created.providerPaymentReference,
            amount: createMoney(2000n, 'USD'),
            idempotencyKey: asProviderIdempotencyKey('capability-partial-capture-unsupported'),
          }),
        ).rejects.toBeInstanceOf(UnsupportedProviderCapabilityError);
      }
    });

    it('refunds a captured payment when refund capabilities allow it', async () => {
      const provider = options.createProvider();
      if (!provider.capabilities.fullRefund && !provider.capabilities.partialRefund) {
        return;
      }
      const created = await provider.createPayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        amount: createMoney(3000n, 'USD'),
        captureMethod: CAPTURE_METHODS.AUTOMATIC,
        idempotencyKey: asProviderIdempotencyKey('refund-create'),
      });
      const captured = await provider.capturePayment({
        organizationId: ORG,
        paymentId: PAYMENT,
        providerPaymentReference: created.providerPaymentReference,
        amount: createMoney(3000n, 'USD'),
        idempotencyKey: asProviderIdempotencyKey('refund-capture'),
      });

      if (provider.capabilities.partialRefund) {
        const refunded = await provider.refundPayment({
          organizationId: ORG,
          paymentId: PAYMENT,
          refundId: REFUND,
          providerPaymentReference: captured.providerPaymentReference,
          amount: createMoney(1000n, 'USD'),
          idempotencyKey: asProviderIdempotencyKey('refund-partial'),
        });
        expect(refunded.providerRefundReference.provider).toBe(provider.code);
        expect(refunded.observedAt).toBeInstanceOf(Date);
      } else if (provider.capabilities.fullRefund) {
        const refunded = await provider.refundPayment({
          organizationId: ORG,
          paymentId: PAYMENT,
          refundId: REFUND,
          providerPaymentReference: captured.providerPaymentReference,
          amount: createMoney(3000n, 'USD'),
          idempotencyKey: asProviderIdempotencyKey('refund-full'),
        });
        expect(refunded.providerRefundReference.provider).toBe(provider.code);
      }
    });
  });
}
