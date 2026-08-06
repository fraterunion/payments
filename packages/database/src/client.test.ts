import { describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';

const FAKE_CONNECTION_STRING = 'postgresql://user:password@localhost:5432/fraterunion_test';

describe('createPrismaClient', () => {
  it('creates a usable client without connecting to a database', () => {
    const client = createPrismaClient({ connectionString: FAKE_CONNECTION_STRING });

    expect(typeof client.$disconnect).toBe('function');
    expect(typeof client.organization.findMany).toBe('function');
  });

  it('returns a new, independent instance on every call (no singleton)', () => {
    const options = { connectionString: FAKE_CONNECTION_STRING };

    const first = createPrismaClient(options);
    const second = createPrismaClient(options);

    expect(first).not.toBe(second);
  });
});
