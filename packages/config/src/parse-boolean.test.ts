import { describe, expect, it } from 'vitest';
import { parseBooleanFlag } from './parse-boolean.js';

describe('parseBooleanFlag', () => {
  it.each(['true', 'TRUE', '1', 'yes', ' true '])('parses %j as true', (value) => {
    expect(parseBooleanFlag(value)).toBe(true);
  });

  it.each(['false', 'FALSE', '0', 'no', ' false '])('parses %j as false', (value) => {
    expect(parseBooleanFlag(value)).toBe(false);
  });

  it('returns undefined for an unrecognized value', () => {
    expect(parseBooleanFlag('maybe')).toBeUndefined();
  });

  it('returns undefined for an undefined value', () => {
    expect(parseBooleanFlag(undefined)).toBeUndefined();
  });
});
