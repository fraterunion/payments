import { generateApiKey, parseApiKey } from './api-key-format.util';

describe('generateApiKey / parseApiKey', () => {
  it('round-trips a TEST key', () => {
    const generated = generateApiKey('TEST');
    expect(generated.fullKey).toMatch(/^fup_test_[0-9a-f]{12}_/);

    const parsed = parseApiKey(generated.fullKey);
    expect(parsed).toEqual({
      environment: 'TEST',
      prefix: generated.prefix,
      secret: generated.secret,
    });
  });

  it('round-trips a LIVE key', () => {
    const generated = generateApiKey('LIVE');
    expect(generated.fullKey).toMatch(/^fup_live_[0-9a-f]{12}_/);

    const parsed = parseApiKey(generated.fullKey);
    expect(parsed?.environment).toBe('LIVE');
  });

  it('generates a unique prefix and secret on every call', () => {
    const a = generateApiKey('TEST');
    const b = generateApiKey('TEST');
    expect(a.prefix).not.toBe(b.prefix);
    expect(a.secret).not.toBe(b.secret);
  });

  it('returns undefined for a key with no recognized environment marker', () => {
    expect(parseApiKey('sk_live_abcdef')).toBeUndefined();
  });

  it('returns undefined for a key missing the secret portion', () => {
    expect(parseApiKey('fup_test_abcdef012345_')).toBeUndefined();
  });

  it('returns undefined for a key with a short prefix', () => {
    expect(parseApiKey('fup_test_abc_somesecretvalue')).toBeUndefined();
  });

  it('returns undefined for a completely unrelated string', () => {
    expect(parseApiKey('not-an-api-key-at-all')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parseApiKey('')).toBeUndefined();
  });

  it('parses correctly even when the secret itself contains underscores', () => {
    const generated = generateApiKey('TEST');
    // base64url can legitimately contain '_' — verify parsing isn't broken by that.
    const keyWithUnderscoreSecret = `fup_test_${generated.prefix}_a_b_c_d`;
    const parsed = parseApiKey(keyWithUnderscoreSecret);
    expect(parsed).toEqual({ environment: 'TEST', prefix: generated.prefix, secret: 'a_b_c_d' });
  });
});
