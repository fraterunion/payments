import type { PinoLogger } from 'nestjs-pino';
import type { DatabaseService } from '../database/database.service';
import { AuditService } from './audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from './audit.types';

function createFakeLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;
}

describe('AuditService', () => {
  it('writes actorUserId for a user actor', async () => {
    const create = jest.fn().mockResolvedValue({});
    const databaseService: Pick<DatabaseService, 'getClient'> = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getClient: () => ({ auditLog: { create } }) as any,
    };
    const service = new AuditService(databaseService as DatabaseService, createFakeLogger());

    await service.record({
      organizationId: 'org-1',
      actor: { type: 'user', userId: 'user-1' },
      action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCEEDED,
      resourceType: AUDIT_RESOURCE_TYPES.USER,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org-1', actorUserId: 'user-1' }),
    });
    expect(create.mock.calls[0][0].data.actorApiKeyId).toBeUndefined();
  });

  it('writes actorApiKeyId for an api_key actor', async () => {
    const create = jest.fn().mockResolvedValue({});
    const databaseService: Pick<DatabaseService, 'getClient'> = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getClient: () => ({ auditLog: { create } }) as any,
    };
    const service = new AuditService(databaseService as DatabaseService, createFakeLogger());

    await service.record({
      organizationId: 'org-1',
      actor: { type: 'api_key', apiKeyId: 'key-1' },
      action: AUDIT_ACTIONS.API_KEY_CREATED,
      resourceType: AUDIT_RESOURCE_TYPES.API_KEY,
    });

    expect(create.mock.calls[0][0].data.actorApiKeyId).toBe('key-1');
    expect(create.mock.calls[0][0].data.actorUserId).toBeUndefined();
  });

  it('writes neither actor field for a system actor', async () => {
    const create = jest.fn().mockResolvedValue({});
    const databaseService: Pick<DatabaseService, 'getClient'> = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getClient: () => ({ auditLog: { create } }) as any,
    };
    const service = new AuditService(databaseService as DatabaseService, createFakeLogger());

    await service.record({
      organizationId: 'org-1',
      actor: { type: 'system' },
      action: AUDIT_ACTIONS.AUTH_REFRESH_REUSE_DETECTED,
      resourceType: AUDIT_RESOURCE_TYPES.SESSION,
    });

    expect(create.mock.calls[0][0].data.actorUserId).toBeUndefined();
    expect(create.mock.calls[0][0].data.actorApiKeyId).toBeUndefined();
  });

  it('defaults metadata to an empty object when omitted', async () => {
    const create = jest.fn().mockResolvedValue({});
    const databaseService: Pick<DatabaseService, 'getClient'> = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getClient: () => ({ auditLog: { create } }) as any,
    };
    const service = new AuditService(databaseService as DatabaseService, createFakeLogger());

    await service.record({
      organizationId: 'org-1',
      actor: { type: 'system' },
      action: AUDIT_ACTIONS.AUTH_REGISTERED,
      resourceType: AUDIT_RESOURCE_TYPES.USER,
    });

    expect(create.mock.calls[0][0].data.metadata).toEqual({});
  });

  it('uses the provided transaction client instead of the default client', async () => {
    const defaultCreate = jest.fn();
    const txCreate = jest.fn().mockResolvedValue({});
    const databaseService: Pick<DatabaseService, 'getClient'> = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getClient: () => ({ auditLog: { create: defaultCreate } }) as any,
    };
    const service = new AuditService(databaseService as DatabaseService, createFakeLogger());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = { auditLog: { create: txCreate } } as any;

    await service.record(
      {
        organizationId: 'org-1',
        actor: { type: 'system' },
        action: AUDIT_ACTIONS.AUTH_REGISTERED,
        resourceType: AUDIT_RESOURCE_TYPES.USER,
      },
      tx,
    );

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(defaultCreate).not.toHaveBeenCalled();
  });

  it('propagates a write failure rather than swallowing it', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db unavailable'));
    const databaseService: Pick<DatabaseService, 'getClient'> = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getClient: () => ({ auditLog: { create } }) as any,
    };
    const service = new AuditService(databaseService as DatabaseService, createFakeLogger());

    await expect(
      service.record({
        organizationId: 'org-1',
        actor: { type: 'system' },
        action: AUDIT_ACTIONS.AUTH_REGISTERED,
        resourceType: AUDIT_RESOURCE_TYPES.USER,
      }),
    ).rejects.toThrow('db unavailable');
  });
});
