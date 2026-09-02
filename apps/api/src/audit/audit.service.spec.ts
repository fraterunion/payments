import type { PinoLogger } from 'nestjs-pino';
import { UnsafeAuditMetadataError } from './audit-metadata';
import { AuditService } from './audit.service';
import { AUDIT_ACTIONS, AUDIT_METADATA_MAX_BYTES, AUDIT_RESOURCE_TYPES } from './audit.types';

function createFakeLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;
}

function createService(create = jest.fn().mockResolvedValue({ id: 'audit-1' })) {
  const findMany = jest.fn().mockResolvedValue([]);
  const service = new AuditService(createFakeLogger());
  return { service, create, findMany };
}

describe('AuditService', () => {
  it('maps USER, API_KEY, and SYSTEM actors onto distinct columns', async () => {
    const { service, create } = createService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { auditLog: { create } } as any;

    await service.write(client, {
      organizationId: 'org-1',
      actor: { type: 'USER', userId: 'user-1' },
      action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCEEDED,
      resource: { type: AUDIT_RESOURCE_TYPES.USER, id: 'user-1' },
    });
    expect(create.mock.calls[0][0].data.actorUserId).toBe('user-1');
    expect(create.mock.calls[0][0].data.actorApiKeyId).toBeUndefined();

    await service.write(client, {
      organizationId: 'org-1',
      actor: { type: 'API_KEY', apiKeyId: 'key-1' },
      action: AUDIT_ACTIONS.API_KEY_CREATED,
      resource: { type: AUDIT_RESOURCE_TYPES.API_KEY, id: 'key-1' },
    });
    expect(create.mock.calls[1][0].data.actorApiKeyId).toBe('key-1');
    expect(create.mock.calls[1][0].data.actorUserId).toBeUndefined();

    await service.write(client, {
      organizationId: 'org-1',
      actor: { type: 'SYSTEM' },
      action: AUDIT_ACTIONS.AUTH_REFRESH_REUSE_DETECTED,
      resource: { type: AUDIT_RESOURCE_TYPES.SESSION },
    });
    expect(create.mock.calls[2][0].data.actorUserId).toBeUndefined();
    expect(create.mock.calls[2][0].data.actorApiKeyId).toBeUndefined();
  });

  it('persists action, resource, organization, and request context', async () => {
    const { service, create } = createService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { auditLog: { create } } as any;

    await service.write(client, {
      organizationId: 'org-1',
      actor: { type: 'USER', userId: 'user-1' },
      action: AUDIT_ACTIONS.AUTH_REGISTERED,
      resource: { type: AUDIT_RESOURCE_TYPES.USER, id: 'user-1' },
      requestContext: {
        requestId: 'req-1',
        ipAddress: '203.0.113.10',
        userAgent: 'a'.repeat(600),
      },
      metadata: { role: 'OWNER' },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        action: 'auth.registered',
        resourceType: 'user',
        resourceId: 'user-1',
        requestId: 'req-1',
        ipAddress: '203.0.113.10',
        metadata: { role: 'OWNER' },
      }),
    });
    expect(create.mock.calls[0][0].data.userAgent).toHaveLength(512);
  });

  it('uses the supplied client and never the default client', async () => {
    const defaultCreate = jest.fn();
    const txCreate = jest.fn().mockResolvedValue({});
    const { service } = createService(defaultCreate);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = { auditLog: { create: txCreate } } as any;

    await service.write(tx, {
      organizationId: 'org-1',
      actor: { type: 'SYSTEM' },
      action: AUDIT_ACTIONS.AUTH_REGISTERED,
      resource: { type: AUDIT_RESOURCE_TYPES.USER },
    });

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(defaultCreate).not.toHaveBeenCalled();
  });

  it('rejects forbidden metadata so a surrounding transaction would roll back', async () => {
    const { service, create } = createService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { auditLog: { create } } as any;

    await expect(
      service.write(client, {
        organizationId: 'org-1',
        actor: { type: 'SYSTEM' },
        action: AUDIT_ACTIONS.AUTH_REGISTERED,
        resource: { type: AUDIT_RESOURCE_TYPES.USER },
        metadata: { password: 'secret' },
      }),
    ).rejects.toBeInstanceOf(UnsafeAuditMetadataError);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects oversized metadata', async () => {
    const { service, create } = createService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { auditLog: { create } } as any;

    await expect(
      service.write(client, {
        organizationId: 'org-1',
        actor: { type: 'SYSTEM' },
        action: AUDIT_ACTIONS.AUTH_REGISTERED,
        resource: { type: AUDIT_RESOURCE_TYPES.USER },
        metadata: { blob: 'x'.repeat(AUDIT_METADATA_MAX_BYTES) },
      }),
    ).rejects.toBeInstanceOf(UnsafeAuditMetadataError);
    expect(create).not.toHaveBeenCalled();
  });

  it('requires a tenant organizationId on list and caps the page size', async () => {
    const { service, findMany } = createService();
    findMany.mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { auditLog: { findMany } } as any;

    await expect(service.list(client, { organizationId: '  ' })).rejects.toThrow(/organizationId/);

    await service.list(client, { organizationId: 'org-1', limit: 500 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1' },
        take: 101,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('applies tenant filters and a (createdAt, id) cursor', async () => {
    const { service, findMany } = createService();
    const cursorAt = new Date('2026-09-02T12:00:00.000Z');
    findMany.mockResolvedValue([
      { id: 'a', createdAt: cursorAt },
      { id: 'b', createdAt: cursorAt },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { auditLog: { findMany } } as any;

    const result = await service.list(client, {
      organizationId: 'org-1',
      action: 'auth.registered',
      actorUserId: 'user-1',
      resourceType: 'user',
      resourceId: 'user-1',
      requestId: 'req-1',
      createdAtFrom: new Date('2026-09-01T00:00:00.000Z'),
      limit: 1,
      cursor: { createdAt: cursorAt, id: 'z' },
    });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toEqual({ createdAt: cursorAt, id: 'a' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          action: 'auth.registered',
          actorUserId: 'user-1',
          resourceType: 'user',
          resourceId: 'user-1',
          requestId: 'req-1',
        }),
      }),
    );
  });
});
