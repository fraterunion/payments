import { generateOpaqueToken, hashApiKeySecret, hashOpaqueToken } from './crypto.util';

describe('generateOpaqueToken', () => {
  it('produces a URL-safe string with no padding characters', () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('encodes 256 bits of randomness', () => {
    const token = generateOpaqueToken();
    // base64url of 32 bytes is 43 characters (no padding).
    expect(token.length).toBe(43);
  });

  it('never produces the same value twice in a reasonable sample', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(1000);
  });
});

describe('hashOpaqueToken', () => {
  it('is deterministic for the same input', () => {
    const token = generateOpaqueToken();
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashOpaqueToken(generateOpaqueToken())).not.toBe(hashOpaqueToken(generateOpaqueToken()));
  });

  it('never returns the original token', () => {
    const token = generateOpaqueToken();
    expect(hashOpaqueToken(token)).not.toBe(token);
  });
});

describe('hashApiKeySecret', () => {
  it('is deterministic for the same secret and pepper', () => {
    const secret = generateOpaqueToken();
    expect(hashApiKeySecret(secret, 'pepper-1')).toBe(hashApiKeySecret(secret, 'pepper-1'));
  });

  it('produces a different hash for a different pepper — the pepper is not decorative', () => {
    const secret = generateOpaqueToken();
    expect(hashApiKeySecret(secret, 'pepper-1')).not.toBe(hashApiKeySecret(secret, 'pepper-2'));
  });
});
