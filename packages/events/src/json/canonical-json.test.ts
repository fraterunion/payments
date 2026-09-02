import { describe, expect, it } from 'vitest';
import { canonicalizeJson } from './canonical-json.js';

describe('canonicalizeJson', () => {
  it('sorts object keys so insertion order does not change the digest input', () => {
    expect(canonicalizeJson({ a: 1, b: 2 })).toBe(canonicalizeJson({ b: 2, a: 1 }));
    expect(canonicalizeJson({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });

  it('preserves array order', () => {
    expect(canonicalizeJson([1, 2])).not.toBe(canonicalizeJson([2, 1]));
  });

  it('sorts nested object keys', () => {
    expect(canonicalizeJson({ z: { b: 1, a: 2 }, y: true })).toBe(
      canonicalizeJson({ y: true, z: { a: 2, b: 1 } }),
    );
  });

  it('rejects unsupported values', () => {
    expect(() => canonicalizeJson(undefined)).toThrow(/rejects/);
    expect(() => canonicalizeJson(() => undefined)).toThrow(/rejects/);
    expect(() => canonicalizeJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });
});
