import type {
  ProviderPaymentObservation,
  ProviderRefundResult,
  RetrieveProviderPaymentResult,
} from '@fraterunion-payments/provider-contracts';
import {
  createProviderPaymentObservation,
  createProviderPaymentReference,
  createProviderRefundReference,
  createProviderRefundResult,
  createRetrieveProviderPaymentResult,
} from '@fraterunion-payments/provider-contracts';
import { mapStripeNextAction } from './action-requirement.js';
import { STRIPE_PROVIDER_CODE } from './constants.js';
import { mapStripePaymentFailure, mapStripeRefundFailure } from './failure.js';
import { mapStripePaymentIntentAmounts } from './payment-intent-amounts.js';
import {
  mapStripePaymentIntentStatus,
  type StripePaymentOperation,
} from './payment-intent-status.js';
import { mapStripeRefundStatus } from './refund.js';
import type { StripePaymentIntentSnapshot, StripeRefundSnapshot } from './stripe-client.js';

export function observeStripePaymentIntent(input: {
  readonly intent: StripePaymentIntentSnapshot;
  readonly operation: StripePaymentOperation;
  readonly observedAt: Date;
}): ProviderPaymentObservation {
  const amounts = mapStripePaymentIntentAmounts(input.intent);
  const state = mapStripePaymentIntentStatus({
    status: input.intent.status,
    captureMethod: input.intent.capture_method,
    operation: input.operation,
  });
  const failure = mapStripePaymentFailure(input.intent.last_payment_error);
  const actionRequirement = mapStripeNextAction(input.intent.next_action);

  return createProviderPaymentObservation({
    providerPaymentReference: createProviderPaymentReference({
      provider: STRIPE_PROVIDER_CODE,
      id: input.intent.id,
    }),
    state,
    observedAt: input.observedAt,
    ...(amounts.authorizedAmount !== undefined
      ? { authorizedAmount: amounts.authorizedAmount }
      : {}),
    ...(amounts.capturedAmount !== undefined ? { capturedAmount: amounts.capturedAmount } : {}),
    ...(actionRequirement !== undefined ? { actionRequirement } : {}),
    ...(failure !== undefined ? { failure } : {}),
  });
}

export function retrieveStripePaymentIntent(input: {
  readonly intent: StripePaymentIntentSnapshot;
  readonly observedAt: Date;
}): RetrieveProviderPaymentResult {
  const observation = observeStripePaymentIntent({
    intent: input.intent,
    operation: 'retrieve',
    observedAt: input.observedAt,
  });
  const amounts = mapStripePaymentIntentAmounts(input.intent);
  return createRetrieveProviderPaymentResult({
    providerPaymentReference: observation.providerPaymentReference,
    state: observation.state,
    requestedAmount: amounts.requestedAmount,
    observedAt: input.observedAt,
    ...(observation.authorizedAmount !== undefined
      ? { authorizedAmount: observation.authorizedAmount }
      : {}),
    ...(observation.capturedAmount !== undefined
      ? { capturedAmount: observation.capturedAmount }
      : {}),
    ...(observation.actionRequirement !== undefined
      ? { actionRequirement: observation.actionRequirement }
      : {}),
    ...(observation.failure !== undefined ? { failure: observation.failure } : {}),
  });
}

export function observeStripeRefund(input: {
  readonly refund: StripeRefundSnapshot;
  readonly observedAt: Date;
}): ProviderRefundResult {
  const failure = mapStripeRefundFailure(input.refund.failure_reason);
  return createProviderRefundResult({
    providerRefundReference: createProviderRefundReference({
      provider: STRIPE_PROVIDER_CODE,
      id: input.refund.id,
    }),
    state: mapStripeRefundStatus(input.refund.status),
    observedAt: input.observedAt,
    ...(failure !== undefined ? { failure } : {}),
  });
}
