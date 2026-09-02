import { assertSafeJsonMetadata, UnsafeMetadataError } from '../common/safe-metadata';
import { PaymentValidationException } from './payment.exceptions';
import { PAYMENT_METADATA_MAX_BYTES, PAYMENT_METADATA_MAX_DEPTH } from './payment.types';

export function assertSafePaymentMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  try {
    return assertSafeJsonMetadata(metadata, {
      label: 'Payment metadata',
      maxBytes: PAYMENT_METADATA_MAX_BYTES,
      maxDepth: PAYMENT_METADATA_MAX_DEPTH,
    });
  } catch (error) {
    if (error instanceof UnsafeMetadataError) {
      throw new PaymentValidationException(error.message);
    }
    throw error;
  }
}
