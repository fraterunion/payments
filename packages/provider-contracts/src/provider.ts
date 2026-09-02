import type { ProviderCapabilities } from './capabilities.js';
import type {
  CancelProviderPaymentInput,
  CaptureProviderPaymentInput,
  CreateProviderCustomerInput,
  CreateProviderCustomerResult,
  CreateProviderPaymentInput,
  ProviderPaymentObservation,
  ProviderRefundResult,
  RefundProviderPaymentInput,
  RetrieveProviderPaymentInput,
  RetrieveProviderPaymentResult,
} from './operations.js';
import type { PaymentProviderCode } from './provider-code.js';

/**
 * Canonical provider adapter contract.
 *
 * Mutating methods require an application-generated idempotency key on
 * the input. Adapters translate provider SDKs into these types and must
 * never leak raw SDK objects or exceptions across the boundary.
 */
export interface PaymentProvider {
  readonly code: PaymentProviderCode;
  readonly capabilities: ProviderCapabilities;

  createCustomer(input: CreateProviderCustomerInput): Promise<CreateProviderCustomerResult>;
  createPayment(input: CreateProviderPaymentInput): Promise<ProviderPaymentObservation>;
  capturePayment(input: CaptureProviderPaymentInput): Promise<ProviderPaymentObservation>;
  cancelPayment(input: CancelProviderPaymentInput): Promise<ProviderPaymentObservation>;
  refundPayment(input: RefundProviderPaymentInput): Promise<ProviderRefundResult>;
  retrievePayment(input: RetrieveProviderPaymentInput): Promise<RetrieveProviderPaymentResult>;
}
