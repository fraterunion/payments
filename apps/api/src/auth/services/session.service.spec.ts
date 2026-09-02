import { UnauthorizedException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import type { AuditService } from '../../audit/audit.service';
import type { AppConfigService } from '../../config/app-config.service';
import type { DatabaseService } from '../../database/database.service';
import { OrganizationMembershipService } from './organization-membership.service';
import { SessionService } from './session.service';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const FUTURE = new Date('2026-06-01T00:00:00.000Z');
const PAST = new Date('2025-01-01T00:00:00.000Z');

function createFakeDb(sessionOverrides: Record<string, jest.Mock> = {}) {
  const session = {
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    ...sessionOverrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    session,
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

function createService(
  db: ReturnType<typeof createFakeDb>,
  options: { soleOrganizationId?: string | undefined } = {},
) {
  const databaseService: Pick<DatabaseService, 'getClient'> = { getClient: () => db };
  const appConfig: Pick<AppConfigService, 'sessionTtlSeconds'> = { sessionTtlSeconds: 2_592_000 };
  const auditService: Pick<AuditService, 'write'> = {
    write: jest.fn().mockResolvedValue({}),
  };
  const memberships: Pick<OrganizationMembershipService, 'findSoleMembership'> = {
    findSoleMembership: jest
      .fn()
      .mockResolvedValue(
        options.soleOrganizationId !== undefined
          ? { organizationId: options.soleOrganizationId }
          : null,
      ),
  };

  const service = new SessionService(
    databaseService as DatabaseService,
    appConfig as AppConfigService,
    auditService as AuditService,
    memberships as OrganizationMembershipService,
    createFakeLogger(),
  );

  return { service, auditService };
}

describe('SessionService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createSession', () => {
    it('creates a session with an expiry derived from the configured TTL', async () => {
      const db = createFakeDb();
      db.session.create.mockResolvedValue({ id: 'session-1' });
      const { service } = createService(db, { soleOrganizationId: 'org-1' });

      const result = await service.createSession('user-1', {});

      expect(db.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          expiresAt: new Date(NOW.getTime() + 2_592_000 * 1000),
        }),
      });
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(result.session).toEqual({ id: 'session-1' });
    });
  });

  describe('rotateSession', () => {
    it('throws for an unknown token without starting a transaction', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue(null);
      const { service } = createService(db);

      await expect(service.rotateSession('unknown-token', {})).rejects.toThrow(
        UnauthorizedException,
      );
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('rejects and revokes the family when the token was already rotated (reuse)', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        sessionFamilyId: 'family-1',
        rotatedAt: PAST,
        revokedAt: PAST,
        expiresAt: FUTURE,
      });
      db.session.updateMany.mockResolvedValue({ count: 2 });
      const { service, auditService } = createService(db, { soleOrganizationId: 'org-1' });

      await expect(service.rotateSession('reused-token', {})).rejects.toThrow(
        UnauthorizedException,
      );

      expect(db.session.updateMany).toHaveBeenCalledWith({
        where: { sessionFamilyId: 'family-1', revokedAt: null },
        data: { revokedAt: NOW },
      });
      expect(auditService.write).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ action: 'auth.refresh_reuse_detected' }),
      );
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an explicitly revoked (but not rotated) session without revoking the family', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        sessionFamilyId: 'family-1',
        rotatedAt: null,
        revokedAt: PAST,
        expiresAt: FUTURE,
      });
      const { service } = createService(db);

      await expect(service.rotateSession('logged-out-token', {})).rejects.toThrow(
        UnauthorizedException,
      );
      expect(db.session.updateMany).not.toHaveBeenCalled();
    });

    it('rejects an expired session', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        sessionFamilyId: 'family-1',
        rotatedAt: null,
        revokedAt: null,
        expiresAt: PAST,
      });
      const { service } = createService(db);

      await expect(service.rotateSession('expired-token', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rotates successfully: revokes the old session, creates a new one inheriting the absolute expiry, and audits', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        sessionFamilyId: 'family-1',
        rotatedAt: null,
        revokedAt: null,
        expiresAt: FUTURE,
      });
      db.session.updateMany.mockResolvedValue({ count: 1 });
      db.session.create.mockResolvedValue({ id: 'session-2', userId: 'user-1', expiresAt: FUTURE });
      const { service, auditService } = createService(db, { soleOrganizationId: 'org-1' });

      const result = await service.rotateSession('valid-refresh-token', {});

      expect(db.session.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', revokedAt: null },
        data: { revokedAt: NOW, rotatedAt: NOW, lastUsedAt: NOW },
      });
      expect(db.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          sessionFamilyId: 'family-1',
          createdBySessionId: 'session-1',
          expiresAt: FUTURE,
        }),
      });
      expect(auditService.write).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ action: 'auth.session_refreshed', organizationId: 'org-1' }),
      );
      expect(result.session.id).toBe('session-2');
      expect(result.refreshToken).toEqual(expect.any(String));
    });

    it('treats a concurrent rotation race (zero rows affected) as reuse and revokes the family', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        sessionFamilyId: 'family-1',
        rotatedAt: null,
        revokedAt: null,
        expiresAt: FUTURE,
      });
      // First updateMany call happens inside the transaction (loses the race); the
      // second happens in revokeFamily's cleanup after the transaction rejects.
      db.session.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
      const { service, auditService } = createService(db, { soleOrganizationId: 'org-1' });

      await expect(service.rotateSession('raced-token', {})).rejects.toThrow(UnauthorizedException);

      expect(db.session.create).not.toHaveBeenCalled();
      expect(auditService.write).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          action: 'auth.refresh_reuse_detected',
          metadata: expect.objectContaining({ reason: 'concurrent_rotation' }),
        }),
      );
    });

    it('skips the audit write when the user does not have exactly one organization membership', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        sessionFamilyId: 'family-1',
        rotatedAt: null,
        revokedAt: null,
        expiresAt: FUTURE,
      });
      db.session.updateMany.mockResolvedValue({ count: 1 });
      db.session.create.mockResolvedValue({ id: 'session-2' });
      const { service, auditService } = createService(db); // no soleOrganizationId => null membership

      await service.rotateSession('valid-refresh-token', {});

      expect(auditService.write).not.toHaveBeenCalled();
    });
  });

  describe('revokeSession', () => {
    it('is idempotent: no audit write when the session was already revoked', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
      db.session.updateMany.mockResolvedValue({ count: 0 });
      const { service, auditService } = createService(db, { soleOrganizationId: 'org-1' });

      await service.revokeSession('session-1', { type: 'USER', userId: 'user-1' }, {});

      expect(auditService.write).not.toHaveBeenCalled();
    });

    it('audits a real revocation', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
      db.session.updateMany.mockResolvedValue({ count: 1 });
      const { service, auditService } = createService(db, { soleOrganizationId: 'org-1' });

      await service.revokeSession('session-1', { type: 'USER', userId: 'user-1' }, {});

      expect(auditService.write).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          action: 'auth.session_revoked',
          resource: { type: 'session', id: 'session-1' },
        }),
      );
    });

    it('is a no-op for a nonexistent session id', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue(null);
      const { service } = createService(db);

      await expect(
        service.revokeSession('missing', { type: 'USER', userId: 'user-1' }, {}),
      ).resolves.toBeUndefined();
      expect(db.session.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllSessions', () => {
    it('audits with the revoked count when sessions were revoked', async () => {
      const db = createFakeDb();
      db.session.updateMany.mockResolvedValue({ count: 3 });
      const { service, auditService } = createService(db, { soleOrganizationId: 'org-1' });

      await service.revokeAllSessions('user-1', { type: 'USER', userId: 'user-1' }, {});

      expect(auditService.write).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          action: 'auth.all_sessions_revoked',
          metadata: { revokedCount: 3 },
        }),
      );
    });

    it('does not audit when there was nothing to revoke', async () => {
      const db = createFakeDb();
      db.session.updateMany.mockResolvedValue({ count: 0 });
      const { service, auditService } = createService(db, { soleOrganizationId: 'org-1' });

      await service.revokeAllSessions('user-1', { type: 'USER', userId: 'user-1' }, {});

      expect(auditService.write).not.toHaveBeenCalled();
    });
  });

  describe('isSessionActive', () => {
    it('is true for a matching, unrevoked, unexpired session', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue({
        userId: 'user-1',
        revokedAt: null,
        expiresAt: FUTURE,
      });
      const { service } = createService(db);

      await expect(service.isSessionActive('session-1', 'user-1')).resolves.toBe(true);
    });

    it('is false when the session belongs to a different user', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue({
        userId: 'someone-else',
        revokedAt: null,
        expiresAt: FUTURE,
      });
      const { service } = createService(db);

      await expect(service.isSessionActive('session-1', 'user-1')).resolves.toBe(false);
    });

    it('is false for a revoked session', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue({
        userId: 'user-1',
        revokedAt: PAST,
        expiresAt: FUTURE,
      });
      const { service } = createService(db);

      await expect(service.isSessionActive('session-1', 'user-1')).resolves.toBe(false);
    });

    it('is false for an expired session', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue({
        userId: 'user-1',
        revokedAt: null,
        expiresAt: PAST,
      });
      const { service } = createService(db);

      await expect(service.isSessionActive('session-1', 'user-1')).resolves.toBe(false);
    });

    it('is false for a nonexistent session', async () => {
      const db = createFakeDb();
      db.session.findUnique.mockResolvedValue(null);
      const { service } = createService(db);

      await expect(service.isSessionActive('missing', 'user-1')).resolves.toBe(false);
    });
  });
});
