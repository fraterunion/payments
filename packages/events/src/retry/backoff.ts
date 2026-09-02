import type { RetryPolicy } from '../types.js';

export type RandomNumber = () => number;

/**
 * Bounded exponential backoff with full jitter.
 *
 * `delay = random() * min(maxDelay, baseDelay * 2^attempt)`
 *
 * `attempt` is the number of completed failed attempts (0-based for the
 * first retry). Inject `random` for deterministic tests.
 */
export function computeRetryDelayMs(
  attempt: number,
  policy: RetryPolicy,
  random: RandomNumber = Math.random,
): number {
  if (attempt < 0) {
    throw new RangeError('attempt must be >= 0');
  }

  const exponential = policy.baseDelayMs * 2 ** attempt;
  const capped = Math.min(policy.maxDelayMs, exponential);
  const sample = random();
  if (sample < 0 || sample > 1) {
    throw new RangeError('random() must return a value in [0, 1].');
  }
  return Math.floor(capped * sample);
}

export function isWithinRetryJitterBounds(
  delayMs: number,
  attempt: number,
  policy: RetryPolicy,
): boolean {
  const exponential = policy.baseDelayMs * 2 ** attempt;
  const capped = Math.min(policy.maxDelayMs, exponential);
  return delayMs >= 0 && delayMs <= capped;
}
