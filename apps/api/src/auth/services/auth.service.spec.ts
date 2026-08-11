import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@fraterunion-payments/database';
import type { AuditService } from '../../audit/audit.service';
import type { DatabaseService } from '../../database/database.service';
import type { RegisterDto } from '../dto/register.dto';
import { AuthService } from './auth.service';
import type { AccessTokenService } from './access-token.service';
import type { OrganizationMembershipService } from './organization-membership.service';
import type { PasswordService } from './password.service';
import type { SessionService } from './session.service';

const VALID_REGISTER_DTO: RegisterDto = {
  email: 'owner@example.com',
  password: 'a sufficiently long passphrase',
  organizationName: 'Acme Gym',
  organizationSlug: 'acme-gym',
  defaultCurrency: 'USD',
  countryCode: 'US',
  timezone: 'America/New_York',
};

function createFakeDb() {
  const user = { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() };
  const organization = { findUnique: jest.fn(), create: jest.fn() };
  const userCredential = { create: jest.fn(), update: jest.fn() };
  const organizationMembership = { create: jest.fn(), findMany: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    user,
    organization,
    userCredential,
    organizationMembership,
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(db)),
  };
  return db;
}

function createDeps(db: ReturnType<typeof createFakeDb>) {
  const databaseService: Pick<DatabaseService, 'getClient'> = { getClient: () => db };

  const passwordService: Pick<
    PasswordService,
    'validatePolicy' | 'hash' | 'verify' | 'verifyDummy' | 'needsRehash'
  > = {
    validatePolicy: jest.fn().mockReturnValue(undefined),
    hash: jest.fn().mockResolvedValue('hashed-password'),
    verify: jest.fn().mockResolvedValue(true),
    verifyDummy: jest.fn().mockResolvedValue(undefined),
    needsRehash: jest.fn().mockReturnValue(false),
  };

  const accessTokenService: Pick<AccessTokenService, 'issue'> = {
    issue: jest.fn().mockReturnValue('signed.access.token'),
  };

  const sessionService: Pick<
    SessionService,
    'createSession' | 'rotateSession' | 'revokeSession' | 'revokeAllSessions' | 'getSession'
  > = {
    createSession: jest.fn().mockResolvedValue({
      session: { id: 'session-1', userId: 'user-1', expiresAt: new Date('2026-06-01') },
      refreshToken: 'opaque-refresh-token',
    }),
    rotateSession: jest.fn(),
    revokeSession: jest.fn().mockResolvedValue(undefined),
    revokeAllSessions: jest.fn().mockResolvedValue(undefined),
    getSession: jest.fn(),
  };

  const auditService: Pick<AuditService, 'record'> = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  const memberships: Pick<OrganizationMembershipService, 'findSoleMembership'> = {
    findSoleMembership: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
  };

  const service = new AuthService(
    databaseService as DatabaseService,
    passwordService as PasswordService,
    accessTokenService as AccessTokenService,
    sessionService as SessionService,
    auditService as AuditService,
    memberships as OrganizationMembershipService,
  );

  return {
    service,
    passwordService,
    accessTokenService,
    sessionService,
    auditService,
    memberships,
  };
}

describe('AuthService.register', () => {
  it('rejects a password that fails policy without touching the database', async () => {
    const db = createFakeDb();
    const { service, passwordService } = createDeps(db);
    (passwordService.validatePolicy as jest.Mock).mockReturnValue(
      'Password must be at least 12 characters.',
    );

    await expect(service.register(VALID_REGISTER_DTO, {})).rejects.toThrow(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an already-registered email', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue({ id: 'existing-user' });
    const { service } = createDeps(db);

    await expect(service.register(VALID_REGISTER_DTO, {})).rejects.toThrow(ConflictException);
    expect(db.organization.create).not.toHaveBeenCalled();
  });

  it('rejects an already-used organization slug', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue(null);
    db.organization.findUnique.mockResolvedValue({ id: 'existing-org' });
    const { service } = createDeps(db);

    await expect(service.register(VALID_REGISTER_DTO, {})).rejects.toThrow(ConflictException);
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('creates the organization, user, credential, OWNER membership, and session atomically, then issues tokens', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue(null);
    db.organization.findUnique.mockResolvedValue(null);
    db.organization.create.mockResolvedValue({ id: 'org-1', name: 'Acme Gym', slug: 'acme-gym' });
    db.user.create.mockResolvedValue({ id: 'user-1', email: 'owner@example.com' });
    const { service, sessionService, auditService, accessTokenService } = createDeps(db);

    const result = await service.register(VALID_REGISTER_DTO, { requestId: 'req-1' });

    expect(db.organizationMembership.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', userId: 'user-1', role: 'OWNER' },
    });
    expect(sessionService.createSession).toHaveBeenCalledWith('user-1', { requestId: 'req-1' }, db);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', action: 'auth.registered' }),
      db,
    );
    expect(accessTokenService.issue).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'session-1',
      email: 'owner@example.com',
    });
    expect(result.accessToken).toBe('signed.access.token');
    expect(result.refreshToken).toBe('opaque-refresh-token');
    expect(result.organization).toEqual({ id: 'org-1', name: 'Acme Gym', slug: 'acme-gym' });
  });

  it('translates a race-condition unique-constraint violation into a generic conflict', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue(null);
    db.organization.findUnique.mockResolvedValue(null);
    db.organization.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const { service } = createDeps(db);

    await expect(service.register(VALID_REGISTER_DTO, {})).rejects.toThrow(ConflictException);
  });
});

describe('AuthService.login', () => {
  const loginDto = { email: 'owner@example.com', password: 'a sufficiently long passphrase' };

  it('performs a dummy verify and rejects generically for an unknown email', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue(null);
    const { service, passwordService } = createDeps(db);

    await expect(service.login(loginDto, {})).rejects.toThrow(UnauthorizedException);
    expect(passwordService.verifyDummy).toHaveBeenCalledWith(loginDto.password);
  });

  it('performs a dummy verify and rejects generically for a user with no credential', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue({ id: 'user-1', status: 'ACTIVE', credential: null });
    const { service, passwordService } = createDeps(db);

    await expect(service.login(loginDto, {})).rejects.toThrow(UnauthorizedException);
    expect(passwordService.verifyDummy).toHaveBeenCalled();
  });

  it('performs a dummy verify and rejects generically for a suspended user', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue({
      id: 'user-1',
      status: 'SUSPENDED',
      credential: { passwordHash: 'hash' },
    });
    const { service, passwordService } = createDeps(db);

    await expect(service.login(loginDto, {})).rejects.toThrow(UnauthorizedException);
    expect(passwordService.verifyDummy).toHaveBeenCalled();
  });

  it('rejects a wrong password with the real credential hash', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue({
      id: 'user-1',
      status: 'ACTIVE',
      credential: { passwordHash: 'real-hash' },
    });
    const { service, passwordService } = createDeps(db);
    (passwordService.verify as jest.Mock).mockResolvedValue(false);

    await expect(service.login(loginDto, {})).rejects.toThrow(UnauthorizedException);
    expect(passwordService.verify).toHaveBeenCalledWith('real-hash', loginDto.password);
  });

  it('logs in successfully: creates a session, records lastLoginAt, and audits', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      status: 'ACTIVE',
      credential: { passwordHash: 'real-hash' },
    });
    const { service, sessionService, auditService, accessTokenService } = createDeps(db);

    const result = await service.login(loginDto, { requestId: 'req-1' });

    expect(sessionService.createSession).toHaveBeenCalledWith('user-1', { requestId: 'req-1' });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', action: 'auth.login_succeeded' }),
    );
    expect(accessTokenService.issue).toHaveBeenCalled();
    expect(result.user).not.toHaveProperty('credential');
  });

  it('rehashes the credential when the stored hash uses outdated parameters', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      status: 'ACTIVE',
      credential: { passwordHash: 'old-hash' },
    });
    const { service, passwordService } = createDeps(db);
    (passwordService.needsRehash as jest.Mock).mockReturnValue(true);
    (passwordService.hash as jest.Mock).mockResolvedValue('new-hash');

    await service.login(loginDto, {});

    expect(db.userCredential.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { passwordHash: 'new-hash', passwordChangedAt: expect.any(Date) },
    });
  });
});

describe('AuthService.refresh', () => {
  it('rotates the session and issues a new access token', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'owner@example.com' });
    const { service, sessionService, accessTokenService } = createDeps(db);
    (sessionService.rotateSession as jest.Mock).mockResolvedValue({
      session: { id: 'session-2', userId: 'user-1', expiresAt: new Date('2026-06-01') },
      refreshToken: 'new-opaque-token',
    });

    const result = await service.refresh('presented-token', {});

    expect(sessionService.rotateSession).toHaveBeenCalledWith('presented-token', {});
    expect(accessTokenService.issue).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'session-2',
      email: 'owner@example.com',
    });
    expect(result.refreshToken).toBe('new-opaque-token');
  });

  it('rejects if the session references a user that no longer exists', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue(null);
    const { service, sessionService } = createDeps(db);
    (sessionService.rotateSession as jest.Mock).mockResolvedValue({
      session: { id: 'session-2', userId: 'ghost-user', expiresAt: new Date('2026-06-01') },
      refreshToken: 'new-opaque-token',
    });

    await expect(service.refresh('presented-token', {})).rejects.toThrow(UnauthorizedException);
  });
});

describe('AuthService.logout / logoutAll', () => {
  const principal = {
    type: 'USER' as const,
    userId: 'user-1',
    sessionId: 'session-1',
    email: 'a@example.com',
  };

  it('logout revokes only the current session', async () => {
    const db = createFakeDb();
    const { service, sessionService } = createDeps(db);

    await service.logout(principal, {});

    expect(sessionService.revokeSession).toHaveBeenCalledWith(
      'session-1',
      { type: 'user', userId: 'user-1' },
      {},
    );
  });

  it('logoutAll revokes every session for the user', async () => {
    const db = createFakeDb();
    const { service, sessionService } = createDeps(db);

    await service.logoutAll(principal, {});

    expect(sessionService.revokeAllSessions).toHaveBeenCalledWith(
      'user-1',
      { type: 'user', userId: 'user-1' },
      {},
    );
  });
});

describe('AuthService.me', () => {
  const principal = {
    type: 'USER' as const,
    userId: 'user-1',
    sessionId: 'session-1',
    email: 'a@example.com',
  };

  it('rejects if the backing session is no longer found', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue({ id: 'user-1' });
    db.organizationMembership.findMany.mockResolvedValue([]);
    const { service, sessionService } = createDeps(db);
    (sessionService.getSession as jest.Mock).mockResolvedValue(null);

    await expect(service.me(principal)).rejects.toThrow(UnauthorizedException);
  });

  it('returns safe user identity, memberships, and session info', async () => {
    const db = createFakeDb();
    db.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      displayName: 'Ada',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01'),
    });
    db.organizationMembership.findMany.mockResolvedValue([
      {
        organizationId: 'org-1',
        role: 'OWNER',
        organization: { name: 'Acme Gym', slug: 'acme-gym' },
      },
    ]);
    const { service, sessionService } = createDeps(db);
    (sessionService.getSession as jest.Mock).mockResolvedValue({
      id: 'session-1',
      expiresAt: new Date('2026-06-01'),
    });

    const result = await service.me(principal);

    expect(result.memberships).toEqual([
      {
        organizationId: 'org-1',
        organizationName: 'Acme Gym',
        organizationSlug: 'acme-gym',
        role: 'OWNER',
      },
    ]);
    expect(result.session).toEqual({ id: 'session-1', expiresAt: new Date('2026-06-01') });
  });
});

describe('AuthService.context', () => {
  it('returns role for a USER principal', () => {
    const db = createFakeDb();
    const { service } = createDeps(db);

    const result = service.context(
      { type: 'USER', userId: 'user-1', sessionId: 'session-1', email: 'a@example.com' },
      { organizationId: 'org-1', role: 'ADMIN' },
    );

    expect(result).toEqual({ principalType: 'USER', organizationId: 'org-1', role: 'ADMIN' });
  });

  it('returns environment and scopes for an API_KEY principal', () => {
    const db = createFakeDb();
    const { service } = createDeps(db);

    const result = service.context(
      {
        type: 'API_KEY',
        apiKeyId: 'key-1',
        organizationId: 'org-1',
        environment: 'TEST',
        scopes: ['organizations:read'],
      },
      { organizationId: 'org-1' },
    );

    expect(result).toEqual({
      principalType: 'API_KEY',
      organizationId: 'org-1',
      environment: 'TEST',
      scopes: ['organizations:read'],
    });
  });
});
