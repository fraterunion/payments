import { createHash } from 'node:crypto';
import {
  asPaymentProviderCode,
  asProviderIdempotencyKey,
  type ProviderIdempotencyKey,
} from '@fraterunion-payments/provider-contracts';
import { asIdempotencyScope } from './idempotency.types';

const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deterministic provider idempotency key derived from the durable FUP
 * operation identity. Never forwards a client `Idempotency-Key`.
 *
 * Future adapters call the provider with this value. Derivation is
 * identity/deduplication, not authentication — no secrets.
 */
export function deriveProviderIdempotencyKey(input: {
  readonly provider: string;
  readonly operation: string;
  readonly operationId: string;
}): ProviderIdempotencyKey {
  const provider = asPaymentProviderCode(input.provider);
  const operation = asIdempotencyScope(input.operation);
  if (!OPERATION_ID_PATTERN.test(input.operationId)) {
    throw new Error('FUP operationId must be a UUID.');
  }
  const operationId = input.operationId.toLowerCase();
  const digest = createHash('sha256')
    .update(`fup\0${provider}\0${operation}\0${operationId}`, 'utf8')
    .digest('hex');
  return asProviderIdempotencyKey(`fup:${digest}`);
}
