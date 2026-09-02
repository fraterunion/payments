import { describe, expect, it } from 'vitest';
import { loadWorkerEnvironment, WorkerEnvironmentValidationError } from './environment.js';

const VALID = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/fraterunion_test',
};

describe('loadWorkerEnvironment', () => {
  it('applies documented defaults', () => {
    const environment = loadWorkerEnvironment(VALID);
    expect(environment.batchSize).toBe(25);
    expect(environment.claimLeaseMs).toBe(60_000);
    expect(environment.maxAttempts).toBe(10);
    expect(environment.retryBaseMs).toBe(1_000);
    expect(environment.retryMaxMs).toBe(900_000);
    expect(environment.concurrency).toBe(5);
    expect(environment.pollIntervalMs).toBe(1_000);
    expect(environment.shutdownTimeoutMs).toBe(30_000);
  });

  it('rejects an absurdly low poll interval and inverted retry bounds', () => {
    expect(() => loadWorkerEnvironment({ ...VALID, WORKER_POLL_INTERVAL_MS: '1' })).toThrow(
      WorkerEnvironmentValidationError,
    );
    expect(() =>
      loadWorkerEnvironment({
        ...VALID,
        WORKER_RETRY_BASE_MS: '5000',
        WORKER_RETRY_MAX_MS: '1000',
      }),
    ).toThrow(/RETRY_MAX_MS/);
  });

  it('does not echo DATABASE_URL in validation errors', () => {
    try {
      loadWorkerEnvironment({ DATABASE_URL: 'mysql://user:supersecret@host/db' });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerEnvironmentValidationError);
      expect(String(error)).not.toContain('supersecret');
    }
  });
});
