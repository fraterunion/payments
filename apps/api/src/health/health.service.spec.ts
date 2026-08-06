import type { DatabaseService } from '../database/database.service';
import { HealthService } from './health.service';

function createFakeDatabaseService(isReady: boolean): Pick<DatabaseService, 'isReady'> {
  return { isReady: jest.fn().mockResolvedValue(isReady) };
}

describe('HealthService', () => {
  it('reports liveness as ok without touching the database', () => {
    const database = createFakeDatabaseService(true);
    const service = new HealthService(database as DatabaseService);

    const result = service.getLiveness();

    expect(result.status).toBe('ok');
    expect(result.check).toBe('liveness');
    expect(result.service).toBe('fraterunion-payments-api');
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
    expect(database.isReady).not.toHaveBeenCalled();
  });

  it('reports readiness as ok when the database responds', async () => {
    const database = createFakeDatabaseService(true);
    const service = new HealthService(database as DatabaseService);

    const result = await service.getReadiness();

    expect(result).toMatchObject({
      status: 'ok',
      check: 'readiness',
      dependencies: { database: 'up' },
    });
  });

  it('reports readiness as error when the database check fails', async () => {
    const database = createFakeDatabaseService(false);
    const service = new HealthService(database as DatabaseService);

    const result = await service.getReadiness();

    expect(result).toMatchObject({
      status: 'error',
      check: 'readiness',
      dependencies: { database: 'down' },
    });
  });

  it('never includes database internals in the readiness result', async () => {
    const database = createFakeDatabaseService(false);
    const service = new HealthService(database as DatabaseService);

    const result = await service.getReadiness();

    expect(JSON.stringify(result)).not.toMatch(/postgres|prisma|password|connection/i);
  });
});
