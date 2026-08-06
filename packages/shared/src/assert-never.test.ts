import { describe, expect, it } from 'vitest';
import { assertNever } from './assert-never.js';

describe('assertNever', () => {
  it('throws an error describing the unexpected value', () => {
    expect(() => assertNever('unexpected' as never)).toThrow('Unexpected value: "unexpected"');
  });
});
