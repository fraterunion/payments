import { AUDIT_METADATA_MAX_BYTES, AUDIT_METADATA_MAX_DEPTH } from './audit.types';

const FORBIDDEN_KEY_TOKENS = new Set([
  'password',
  'passwordhash',
  'token',
  'refreshtoken',
  'accesstoken',
  'sessiontoken',
  'sessiontokenhash',
  'apikey',
  'apikeysecret',
  'secrethash',
  'secret',
  'authorization',
  'cookie',
  'cookies',
  'cardnumber',
  'cvc',
  'pan',
  'databaseurl',
  'jwt',
  'jwtaccesssecret',
  'apikeyhashsecret',
]);

const FORBIDDEN_VALUE_PATTERNS: readonly RegExp[] = [
  /postgresql:\/\/[^\s]+/i,
  /postgres:\/\/[^\s]+/i,
  /bearer\s+[a-z0-9._~+/=-]+/i,
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,
  /fup_(?:test|live)_[0-9a-f]+_[A-Za-z0-9_-]+/,
];

export class UnsafeAuditMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeAuditMetadataError';
  }
}

/**
 * Defense-in-depth check before persist. Callers must still construct
 * only safe metadata. Rejection rolls back any surrounding transaction.
 */
export function assertSafeAuditMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  assertSafeValue(metadata, 0, 'metadata');
  const serialized = JSON.stringify(metadata);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > AUDIT_METADATA_MAX_BYTES) {
    throw new UnsafeAuditMetadataError(
      `Audit metadata exceeds ${AUDIT_METADATA_MAX_BYTES} UTF-8 bytes.`,
    );
  }
  return metadata;
}

function assertSafeValue(value: unknown, depth: number, path: string): void {
  if (depth > AUDIT_METADATA_MAX_DEPTH) {
    throw new UnsafeAuditMetadataError(
      `Audit metadata exceeds maximum nesting depth of ${AUDIT_METADATA_MAX_DEPTH}.`,
    );
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return;
  }

  if (typeof value === 'string') {
    for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        throw new UnsafeAuditMetadataError(`Audit metadata at ${path} contains a forbidden value.`);
      }
    }
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
      if (isForbiddenKey(key)) {
        throw new UnsafeAuditMetadataError(`Audit metadata key "${key}" is forbidden.`);
      }
      assertSafeValue(nested, depth + 1, `${path}.${key}`);
    }
    return;
  }

  throw new UnsafeAuditMetadataError(`Audit metadata at ${path} has an unsupported value type.`);
}

function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEY_TOKENS.has(key.toLowerCase().replace(/[_-]/g, ''));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}
