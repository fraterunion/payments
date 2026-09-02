export class UnsafeMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeMetadataError';
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

export type SafeMetadataLimits = {
  readonly label: string;
  readonly maxBytes: number;
  readonly maxDepth: number;
};

export function assertSafeJsonMetadata(
  metadata: Record<string, unknown>,
  limits: SafeMetadataLimits,
): Record<string, unknown> {
  if (!isPlainObject(metadata)) {
    throw new UnsafeMetadataError(`${limits.label} must be a JSON object.`);
  }
  assertSafeValue(metadata, 0, 'metadata', limits);
  const bytes = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
  if (bytes > limits.maxBytes) {
    throw new UnsafeMetadataError(`${limits.label} exceeds ${limits.maxBytes} UTF-8 bytes.`);
  }
  return metadata;
}

function assertSafeValue(
  value: unknown,
  depth: number,
  path: string,
  limits: SafeMetadataLimits,
): void {
  if (depth > limits.maxDepth) {
    throw new UnsafeMetadataError(`${limits.label} is nested too deeply.`);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return;
  }
  if (typeof value === 'string') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSafeValue(item, depth + 1, `${path}[${index}]`, limits);
    });
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_KEY_TOKENS.has(key.toLowerCase().replace(/[_-]/g, ''))) {
        throw new UnsafeMetadataError(`${limits.label} key "${key}" is not allowed.`);
      }
      assertSafeValue(nested, depth + 1, `${path}.${key}`, limits);
    }
    return;
  }
  throw new UnsafeMetadataError(`${limits.label} at ${path} has an unsupported value type.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}
