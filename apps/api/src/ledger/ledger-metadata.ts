import { assertSafeJsonMetadata } from '../common/safe-metadata';

const LEDGER_METADATA_MAX_BYTES = 4096;
const LEDGER_METADATA_MAX_DEPTH = 4;

export function assertSafeLedgerMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return assertSafeJsonMetadata(metadata, {
    label: 'Ledger metadata',
    maxBytes: LEDGER_METADATA_MAX_BYTES,
    maxDepth: LEDGER_METADATA_MAX_DEPTH,
  });
}
