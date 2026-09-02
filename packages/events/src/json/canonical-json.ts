/**
 * Deterministic JSON serialization for payload hashing.
 *
 * Object keys are sorted recursively. Array order is preserved. Unsupported
 * values (undefined, bigint, function, symbol, non-finite numbers) are
 * rejected so two semantically different values cannot collide by accident.
 */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') {
    return value;
  }

  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON rejects non-finite numbers.');
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      result[key] = canonicalizeValue(value[key]);
    }
    return result;
  }

  throw new TypeError(`Canonical JSON rejects values of type ${valueType}.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}
