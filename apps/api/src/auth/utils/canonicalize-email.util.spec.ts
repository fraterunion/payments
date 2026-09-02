import { canonicalizeEmail, canonicalizeEmailTransform } from './canonicalize-email.util';

describe('canonicalizeEmail', () => {
  it('trims surrounding whitespace and lowercases', () => {
    expect(canonicalizeEmail('  Owner@Example.com  ')).toBe('owner@example.com');
  });

  it('does not remove dots or rewrite plus-aliases', () => {
    expect(canonicalizeEmail('Ada.Lovelace+Gym@Example.COM')).toBe('ada.lovelace+gym@example.com');
  });

  it('leaves an already-canonical address unchanged', () => {
    expect(canonicalizeEmail('owner@example.com')).toBe('owner@example.com');
  });
});

describe('canonicalizeEmailTransform', () => {
  it('canonicalizes string values and passes non-strings through', () => {
    expect(canonicalizeEmailTransform({ value: '  OWNER@example.com ' })).toBe('owner@example.com');
    expect(canonicalizeEmailTransform({ value: 12 })).toBe(12);
    expect(canonicalizeEmailTransform({ value: undefined })).toBeUndefined();
  });
});
