import { describe, expect, it } from 'vitest';
import { hashPayload } from './payload-hash.js';

describe('hashPayload', () => {
  it('is stable across object key order', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it('changes when array order changes', () => {
    expect(hashPayload([1, 2])).not.toBe(hashPayload([2, 1]));
  });

  it('produces a 64-character SHA-256 hex digest', () => {
    expect(hashPayload({ hello: 'world' })).toMatch(/^[0-9a-f]{64}$/);
  });
});
