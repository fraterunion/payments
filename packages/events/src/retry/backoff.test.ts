import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_POLICY } from '../types.js';
import { computeRetryDelayMs, isWithinRetryJitterBounds } from './backoff.js';

describe('computeRetryDelayMs', () => {
  it('returns 0 when random is 0 and the full exponential when random is 1', () => {
    expect(computeRetryDelayMs(0, DEFAULT_RETRY_POLICY, () => 0)).toBe(0);
    expect(computeRetryDelayMs(0, DEFAULT_RETRY_POLICY, () => 1)).toBe(
      DEFAULT_RETRY_POLICY.baseDelayMs,
    );
  });

  it('grows exponentially and caps at maxDelay', () => {
    const policy = { maxAttempts: 10, baseDelayMs: 1_000, maxDelayMs: 8_000 };
    expect(computeRetryDelayMs(0, policy, () => 1)).toBe(1_000);
    expect(computeRetryDelayMs(1, policy, () => 1)).toBe(2_000);
    expect(computeRetryDelayMs(2, policy, () => 1)).toBe(4_000);
    expect(computeRetryDelayMs(3, policy, () => 1)).toBe(8_000);
    expect(computeRetryDelayMs(10, policy, () => 1)).toBe(8_000);
  });

  it('stays within jitter bounds for sampled delays', () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const delay = computeRetryDelayMs(attempt, DEFAULT_RETRY_POLICY, () => 0.37);
      expect(isWithinRetryJitterBounds(delay, attempt, DEFAULT_RETRY_POLICY)).toBe(true);
    }
  });
});
