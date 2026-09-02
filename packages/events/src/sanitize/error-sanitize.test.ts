import { describe, expect, it } from 'vitest';
import { sanitizeErrorMessage } from './error-sanitize.js';

describe('sanitizeErrorMessage', () => {
  it('keeps a short operational message', () => {
    expect(sanitizeErrorMessage(new Error('provider timed out'))).toBe('provider timed out');
  });

  it('drops stack frames and redacts connection strings and tokens', () => {
    const error = new Error(
      'connect failed postgresql://user:supersecret@localhost:5432/db\n    at Worker.run (worker.ts:1:1)',
    );
    const sanitized = sanitizeErrorMessage(error);
    expect(sanitized).not.toContain('supersecret');
    expect(sanitized).not.toContain('at Worker.run');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('redacts JWTs and API keys', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc';
    expect(sanitizeErrorMessage(`Bearer ${jwt}`)).not.toContain(jwt);
    expect(sanitizeErrorMessage('bad key fup_test_abcdef012345_s3cretvaluehere')).not.toContain(
      's3cretvaluehere',
    );
  });

  it('never persists a stack as the message', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at secret.ts:12';
    expect(sanitizeErrorMessage(error)).toBe('boom');
  });
});
