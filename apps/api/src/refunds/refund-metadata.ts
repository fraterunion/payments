import { assertSafeJsonMetadata, UnsafeMetadataError } from '../common/safe-metadata';
import { RefundValidationException } from './refund.exceptions';
import { REFUND_METADATA_MAX_BYTES, REFUND_METADATA_MAX_DEPTH } from './refund.types';

export function assertSafeRefundMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  try {
    return assertSafeJsonMetadata(metadata, {
      label: 'Refund metadata',
      maxBytes: REFUND_METADATA_MAX_BYTES,
      maxDepth: REFUND_METADATA_MAX_DEPTH,
    });
  } catch (error) {
    if (error instanceof UnsafeMetadataError) {
      throw new RefundValidationException(error.message);
    }
    throw error;
  }
}
