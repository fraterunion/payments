import { describe, expect, it } from 'vitest';
import { isRetryableFailure, RetryableEventError, TerminalEventError } from './errors.js';

describe('isRetryableFailure', () => {
  it('classifies explicit terminal errors as not retryable', () => {
    expect(isRetryableFailure(new TerminalEventError('no handler'))).toBe(false);
  });

  it('classifies explicit retryable errors and unexpected errors as retryable', () => {
    expect(isRetryableFailure(new RetryableEventError('later'))).toBe(true);
    expect(isRetryableFailure(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableFailure('string boom')).toBe(true);
  });
});
