import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Prisma, Session } from '@fraterunion-payments/database';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, type AuditActor } from '../../audit/audit.types';
import { AppConfigService } from '../../config/app-config.service';
import { DatabaseService } from '../../database/database.service';
import type { DatabaseClient } from '../../database/database.types';
import type { RequestContext } from '../types/request-context.type';
import { generateOpaqueToken, hashOpaqueToken } from '../utils/crypto.util';
import { OrganizationMembershipService } from './organization-membership.service';

type QueryClient = DatabaseClient | Prisma.TransactionClient;

export interface SessionAndToken {
  readonly session: Session;
  readonly refreshToken: string;
}

/** Internal signal that the conditional rotation update affected zero rows — a concurrent refresh already won. */
class ConcurrentRotationDetected extends Error {
  constructor(
    readonly sessionFamilyId: string,
    readonly userId: string,
  ) {
    super('Concurrent rotation detected.');
  }
}

/**
 * Owns the full session/refresh-token lifecycle: creation at login,
 * rotation on refresh (with reuse detection), and revocation (single
 * session or all of a user's sessions). See
 * docs/architecture/authentication-and-access-control.md for the
 * `sessionFamilyId`/`createdBySessionId`/`rotatedAt` design this
 * implementation follows.
 *
 * Audit note: session lifecycle events are user-scoped, not inherently
 * org-scoped, but `AuditLog.organizationId` is required. This commit has no
 * invitation feature, so every user has exactly one organization
 * membership (the one created at registration) — audit records for
 * login/refresh/logout events use that organization. If a user's
 * membership count is ever not exactly one (only possible after a future
 * multi-org feature), the audit write is skipped rather than guessed, and a
 * warning is logged — this is a deliberate, documented limitation, not an
 * oversight.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly appConfig: AppConfigService,
    private readonly auditService: AuditService,
    private readonly memberships: OrganizationMembershipService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SessionService.name);
  }

  async createSession(
    userId: string,
    context: RequestContext,
    client?: QueryClient,
  ): Promise<SessionAndToken> {
    const db = client ?? this.databaseService.getClient();
    const refreshToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.appConfig.sessionTtlSeconds * 1000);

    const session = await db.session.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(refreshToken),
        expiresAt,
        ...(context.ipAddress !== undefined ? { ipAddress: context.ipAddress } : {}),
        ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      },
    });

    return { session, refreshToken };
  }

  /**
   * Rotates a refresh token. Throws `UnauthorizedException` with a generic
   * message on every failure path (unknown token, already-rotated token,
   * already-revoked session, expired session) — the response never
   * distinguishes these, to avoid handing an attacker a diagnostic oracle.
   */
  async rotateSession(presentedToken: string, context: RequestContext): Promise<SessionAndToken> {
    const db = this.databaseService.getClient();
    const tokenHash = hashOpaqueToken(presentedToken);
    const existing = await db.session.findUnique({ where: { tokenHash } });

    if (existing === null) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (existing.rotatedAt !== null) {
      await this.revokeFamily(
        existing.sessionFamilyId,
        existing.userId,
        context,
        'reuse_of_rotated_token',
      );
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (existing.revokedAt !== null || existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const newRefreshToken = generateOpaqueToken();
    const now = new Date();

    try {
      const session = await db.$transaction(async (tx) => {
        const rotationResult = await tx.session.updateMany({
          where: { id: existing.id, revokedAt: null },
          data: { revokedAt: now, rotatedAt: now, lastUsedAt: now },
        });

        if (rotationResult.count === 0) {
          throw new ConcurrentRotationDetected(existing.sessionFamilyId, existing.userId);
        }

        const created = await tx.session.create({
          data: {
            userId: existing.userId,
            tokenHash: hashOpaqueToken(newRefreshToken),
            sessionFamilyId: existing.sessionFamilyId,
            createdBySessionId: existing.id,
            // Inherited, not recomputed: the whole rotation chain shares the
            // absolute expiry set at login, so rotation never extends a
            // session indefinitely (no unlimited sliding sessions).
            expiresAt: existing.expiresAt,
            ...(context.ipAddress !== undefined ? { ipAddress: context.ipAddress } : {}),
            ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
          },
        });

        const organizationId = await this.resolveAuditOrganizationId(existing.userId, tx);
        if (organizationId !== undefined) {
          await this.auditService.write(tx, {
            organizationId,
            actor: { type: 'USER', userId: existing.userId },
            action: AUDIT_ACTIONS.AUTH_SESSION_REFRESHED,
            resource: { type: AUDIT_RESOURCE_TYPES.SESSION, id: created.id },
            requestContext: context,
          });
        }

        return created;
      });

      return { session, refreshToken: newRefreshToken };
    } catch (error) {
      if (error instanceof ConcurrentRotationDetected) {
        await this.revokeFamily(
          error.sessionFamilyId,
          error.userId,
          context,
          'concurrent_rotation',
        );
        throw new UnauthorizedException('Invalid refresh token.');
      }
      throw error;
    }
  }

  /** Idempotent: revoking an already-revoked (or nonexistent) session is a no-op, not an error. */
  async revokeSession(
    sessionId: string,
    actor: AuditActor,
    context: RequestContext,
  ): Promise<void> {
    const db = this.databaseService.getClient();
    const now = new Date();

    const session = await db.session.findUnique({ where: { id: sessionId } });
    if (session === null) return;

    const result = await db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });

    if (result.count === 0) return;

    const organizationId = await this.resolveAuditOrganizationId(session.userId);
    if (organizationId !== undefined) {
      await this.auditService.write(db, {
        organizationId,
        actor,
        action: AUDIT_ACTIONS.AUTH_SESSION_REVOKED,
        resource: { type: AUDIT_RESOURCE_TYPES.SESSION, id: sessionId },
        requestContext: context,
      });
    }
  }

  async revokeAllSessions(
    userId: string,
    actor: AuditActor,
    context: RequestContext,
  ): Promise<void> {
    const db = this.databaseService.getClient();
    const now = new Date();

    const result = await db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });

    if (result.count === 0) return;

    const organizationId = await this.resolveAuditOrganizationId(userId);
    if (organizationId !== undefined) {
      await this.auditService.write(db, {
        organizationId,
        actor,
        action: AUDIT_ACTIONS.AUTH_ALL_SESSIONS_REVOKED,
        resource: { type: AUDIT_RESOURCE_TYPES.USER, id: userId },
        requestContext: context,
        metadata: { revokedCount: result.count },
      });
    }
  }

  /** Used by the active-session guard. Never throws — an invalid id is simply not active. */
  async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    const db = this.databaseService.getClient();
    const session = await db.session.findUnique({ where: { id: sessionId } });
    return (
      session !== null &&
      session.userId === userId &&
      session.revokedAt === null &&
      session.expiresAt.getTime() > Date.now()
    );
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const db = this.databaseService.getClient();
    return db.session.findUnique({ where: { id: sessionId } });
  }

  private async revokeFamily(
    sessionFamilyId: string,
    userId: string,
    context: RequestContext,
    reason: 'reuse_of_rotated_token' | 'concurrent_rotation',
  ): Promise<void> {
    const db = this.databaseService.getClient();
    const now = new Date();

    await db.session.updateMany({
      where: { sessionFamilyId, revokedAt: null },
      data: { revokedAt: now },
    });

    this.logger.warn(
      { sessionFamilyId, userId, reason },
      'Refresh token reuse detected; session family revoked.',
    );

    const organizationId = await this.resolveAuditOrganizationId(userId);
    if (organizationId !== undefined) {
      await this.auditService.write(db, {
        organizationId,
        actor: { type: 'USER', userId },
        action: AUDIT_ACTIONS.AUTH_REFRESH_REUSE_DETECTED,
        resource: { type: AUDIT_RESOURCE_TYPES.SESSION },
        requestContext: context,
        metadata: { sessionFamilyId, reason },
      });
    }
  }

  private async resolveAuditOrganizationId(
    userId: string,
    client?: Parameters<OrganizationMembershipService['findSoleMembership']>[1],
  ): Promise<string | undefined> {
    const membership = await this.memberships.findSoleMembership(userId, client);
    if (membership === null) {
      this.logger.warn(
        { userId },
        'Skipping audit write: user does not have exactly one organization membership.',
      );
      return undefined;
    }
    return membership.organizationId;
  }
}
