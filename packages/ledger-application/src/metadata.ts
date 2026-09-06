class UnsafeLedgerMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeLedgerMetadataError';
  }
}

const FORBIDDEN_KEY_TOKENS = new Set([
  'password',
  'token',
  'refreshtoken',
  'accesstoken',
  'apikey',
  'secret',
  'secretkey',
  'authorization',
  'pan',
  'cvc',
  'cardnumber',
  'databaseurl',
  'providersecret',
  'providerkey',
]);

const LEDGER_METADATA_MAX_BYTES = 4096;
const LEDGER_METADATA_MAX_DEPTH = 4;

export function assertSafeLedgerMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  if (!isPlainObject(metadata)) {
    throw new UnsafeLedgerMetadataError('Ledger metadata must be a JSON object.');
  }
  assertSafeValue(metadata, 0, 'metadata');
  const bytes = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
  if (bytes > LEDGER_METADATA_MAX_BYTES) {
    throw new UnsafeLedgerMetadataError(
      `Ledger metadata exceeds ${LEDGER_METADATA_MAX_BYTES} UTF-8 bytes.`,
    );
  }
  return metadata;
}

function assertSafeValue(value: unknown, depth: number, path: string): void {
  if (depth > LEDGER_METADATA_MAX_DEPTH) {
    throw new UnsafeLedgerMetadataError('Ledger metadata is nested too deeply.');
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return;
  }
  if (typeof value === 'string') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSafeValue(item, depth + 1, `${path}[${index}]`);
    });
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_KEY_TOKENS.has(key.toLowerCase().replace(/[_-]/g, ''))) {
        throw new UnsafeLedgerMetadataError(`Ledger metadata key "${key}" is not allowed.`);
      }
      assertSafeValue(nested, depth + 1, `${path}.${key}`);
    }
    return;
  }
  throw new UnsafeLedgerMetadataError(`Ledger metadata at ${path} has an unsupported value type.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}
