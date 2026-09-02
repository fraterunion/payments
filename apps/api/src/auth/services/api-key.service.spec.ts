import { UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@fraterunion-payments/database';
import type { PinoLogger } from 'nestjs-pino';
import type { AuditService } from '../../audit/audit.service';
import type { AppConfigService } from '../../config/app-config.service';
import type { DatabaseService } from '../../database/database.service';
import { ApiKeyService } from './api-key.service';
import { generateApiKey, parseApiKey } from '../utils/api-key-format.util';
import { hashApiKeySecret } from '../utils/crypto.util';

const PEPPER = 'test-api-key-hash-secret';

function createFakeDb(apiKeyOverrides: Record<string, jest.Mock> = {}) {
  const apiKey = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    ...apiKeyOverrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    apiKey,
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(db)),
  };
  return db;
}

function createFakeLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;
}

function createService(db: ReturnType<typeof createFakeDb>) {
  const databaseService: Pick<DatabaseService, 'getClient'> = { getClient: () => db };
  const appConfig: Pick<AppConfigService, 'apiKeyHashSecret'> = { apiKeyHashSecret: PEPPER };
  const auditService: Pick<AuditService, 'write'> = {
    write: jest.fn().mockResolvedValue({}),
  };

  const service = new ApiKeyService(
    databaseService as DatabaseService,
    appConfig as AppConfigService,
    auditService as AuditService,
    createFakeLogger(),
  );

  return { service, auditService };
}

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('ApiKeyService', () => {
  describe('create', () => {
    it('generates a key, hashes only the secret, and audits within the same transaction', async () => {
      const db = createFakeDb();
      db.apiKey.create.mockResolvedValue({ id: 'key-1', keyPrefix: 'abc' });
      const { service, auditService } = createService(db);

      const result = await service.create(
        {
          organizationId: 'org-1',
          name: 'CI key',
          environment: 'TEST',
          scopes: ['organizations:read'],
          createdByUserId: 'user-1',
        },
        { type: 'USER', userId: 'user-1' },
        {},
      );

      expect(result.plaintextKey).toMatch(/^fup_test_/);
      expect(db.apiKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          name: 'CI key',
          status: 'ACTIVE',
          environment: 'TEST',
          scopes: ['organizations:read'],
        }),
      });
      const createdData = db.apiKey.create.mock.calls[0][0].data;
      expect(createdData.secretHash).not.toContain(result.plaintextKey);
      expect(auditService.write).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ action: 'api_key.created' }),
      );
    });

    it('retries generation on a unique-constraint collision and eventually succeeds', async () => {
      const db = createFakeDb();
      db.apiKey.create
        .mockRejectedValueOnce(uniqueConstraintError())
        .mockResolvedValueOnce({ id: 'key-2' });
      const { service } = createService(db);

      const result = await service.create(
        {
          organizationId: 'org-1',
          name: 'k',
          environment: 'TEST',
          scopes: [],
          createdByUserId: 'user-1',
        },
        { type: 'USER', userId: 'user-1' },
        {},
      );

      expect(db.apiKey.create).toHaveBeenCalledTimes(2);
      expect(result.apiKey).toEqual({ id: 'key-2' });
    });

    it('gives up after the maximum number of collision retries', async () => {
      const db = createFakeDb();
      db.apiKey.create.mockRejectedValue(uniqueConstraintError());
      const { service } = createService(db);

      await expect(
        service.create(
          {
            organizationId: 'org-1',
            name: 'k',
            environment: 'TEST',
            scopes: [],
            createdByUserId: 'user-1',
          },
          { type: 'USER', userId: 'user-1' },
          {},
        ),
      ).rejects.toThrow();
    });

    it('propagates a non-collision error immediately without retrying', async () => {
      const db = createFakeDb();
      db.apiKey.create.mockRejectedValue(new Error('unexpected db error'));
      const { service } = createService(db);

      await expect(
        service.create(
          {
            organizationId: 'org-1',
            name: 'k',
            environment: 'TEST',
            scopes: [],
            createdByUserId: 'user-1',
          },
          { type: 'USER', userId: 'user-1' },
          {},
        ),
      ).rejects.toThrow('unexpected db error');
      expect(db.apiKey.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('revoke', () => {
    it('is idempotent and scoped to the organization (cross-tenant safe)', async () => {
      const db = createFakeDb();
      db.apiKey.updateMany.mockResolvedValue({ count: 0 });
      const { service, auditService } = createService(db);

      await service.revoke('key-1', 'org-1', { type: 'USER', userId: 'user-1' }, {});

      expect(db.apiKey.updateMany).toHaveBeenCalledWith({
        where: { id: 'key-1', organizationId: 'org-1', status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: expect.any(Date) },
      });
      expect(auditService.write).not.toHaveBeenCalled();
    });

    it('audits a real revocation', async () => {
      const db = createFakeDb();
      db.apiKey.updateMany.mockResolvedValue({ count: 1 });
      const { service, auditService } = createService(db);

      await service.revoke('key-1', 'org-1', { type: 'USER', userId: 'user-1' }, {});

      expect(auditService.write).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ action: 'api_key.revoked' }),
      );
    });
  });

  describe('authenticate', () => {
    it('rejects a malformed key without querying the database', async () => {
      const db = createFakeDb();
      const { service } = createService(db);

      await expect(service.authenticate('not-a-key')).rejects.toThrow(UnauthorizedException);
      expect(db.apiKey.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an unknown key', async () => {
      const db = createFakeDb();
      db.apiKey.findUnique.mockResolvedValue(null);
      const { service } = createService(db);

      const generated = generateApiKey('TEST');
      await expect(service.authenticate(generated.fullKey)).rejects.toThrow(UnauthorizedException);
    });

    it('looks up by the hash of the presented secret, keyed with the configured pepper', async () => {
      const db = createFakeDb();
      db.apiKey.findUnique.mockResolvedValue(null);
      const { service } = createService(db);

      const generated = generateApiKey('TEST');
      await expect(service.authenticate(generated.fullKey)).rejects.toThrow(UnauthorizedException);

      const expectedHash = hashApiKeySecret(generated.secret, PEPPER);
      expect(db.apiKey.findUnique).toHaveBeenCalledWith({
        where: { secretHash: expectedHash },
        include: { organization: true },
      });
    });

    it('rejects a revoked key', async () => {
      const db = createFakeDb();
      db.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        status: 'REVOKED',
        expiresAt: null,
        organization: { status: 'ACTIVE' },
      });
      const { service } = createService(db);

      await expect(service.authenticate(generateApiKey('TEST').fullKey)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired key', async () => {
      const db = createFakeDb();
      db.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        status: 'ACTIVE',
        expiresAt: new Date('2000-01-01'),
        organization: { status: 'ACTIVE' },
      });
      const { service } = createService(db);

      await expect(service.authenticate(generateApiKey('TEST').fullKey)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a key belonging to a suspended organization', async () => {
      const db = createFakeDb();
      db.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        status: 'ACTIVE',
        expiresAt: null,
        organization: { status: 'SUSPENDED' },
      });
      const { service } = createService(db);

      await expect(service.authenticate(generateApiKey('TEST').fullKey)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('authenticates a valid key and returns its principal fields', async () => {
      const db = createFakeDb();
      db.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        organizationId: 'org-1',
        environment: 'TEST',
        scopes: ['organizations:read'],
        status: 'ACTIVE',
        expiresAt: null,
        organization: { status: 'ACTIVE' },
      });
      db.apiKey.update.mockResolvedValue({});
      const { service } = createService(db);

      const result = await service.authenticate(generateApiKey('TEST').fullKey);

      expect(result).toEqual({
        apiKeyId: 'key-1',
        organizationId: 'org-1',
        environment: 'TEST',
        scopes: ['organizations:read'],
      });
    });

    it('never fails authentication when the best-effort lastUsedAt update fails', async () => {
      const db = createFakeDb();
      db.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        organizationId: 'org-1',
        environment: 'TEST',
        scopes: [],
        status: 'ACTIVE',
        expiresAt: null,
        organization: { status: 'ACTIVE' },
      });
      db.apiKey.update.mockRejectedValue(new Error('write failed'));
      const { service } = createService(db);

      await expect(service.authenticate(generateApiKey('TEST').fullKey)).resolves.toEqual(
        expect.objectContaining({ apiKeyId: 'key-1' }),
      );
    });
  });
});

// Sanity check that the test file's own key-generation helper matches what production code expects.
describe('test fixture sanity', () => {
  it('generateApiKey/parseApiKey agree on TEST', () => {
    const generated = generateApiKey('TEST');
    expect(parseApiKey(generated.fullKey)?.secret).toBe(generated.secret);
  });
});
