import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Organization, Session, User } from '@fraterunion-payments/database';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from '../../audit/audit.types';
import { DatabaseService } from '../../database/database.service';
import type { LoginDto } from '../dto/login.dto';
import type { RegisterDto } from '../dto/register.dto';
import type { MeResult } from '../types/me.type';
import type { OrganizationContext } from '../types/organization-context.type';
import type { Principal, UserPrincipal } from '../types/principal.type';
import type { RequestContext } from '../types/request-context.type';
import { isUniqueConstraintViolation } from '../utils/prisma-error.util';
import { AccessTokenService } from './access-token.service';
import { OrganizationMembershipService } from './organization-membership.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

export interface AuthResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly user: User;
  readonly session: Session;
}

export interface RegisterResult extends AuthResult {
  readonly organization: Organization;
}

export interface RefreshResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly session: Session;
}

export type AuthContextResult =
  | {
      readonly principalType: 'USER';
      readonly organizationId: string;
      readonly role: OrganizationContext['role'];
    }
  | {
      readonly principalType: 'API_KEY';
      readonly organizationId: string;
      readonly environment: Extract<Principal, { type: 'API_KEY' }>['environment'];
      readonly scopes: readonly string[];
    };

/**
 * Orchestrates the human-authentication flows (`register`, `login`,
 * `refresh`, `logout`, `logoutAll`, `me`, `context`) by composing the
 * specialized services (`PasswordService`, `AccessTokenService`,
 * `SessionService`, `AuditService`, `OrganizationMembershipService`) rather
 * than re-implementing any of their concerns. See
 * docs/architecture/authentication-and-access-control.md for the end-to-end
 * flow this service implements.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly passwordService: PasswordService,
    private readonly accessTokenService: AccessTokenService,
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
    private readonly memberships: OrganizationMembershipService,
  ) {}

  /**
   * Creates a new BUSINESS organization, its first user, an `OWNER`
   * membership, and the user's first session — all atomically, per
   * docs/architecture/authentication-and-access-control.md. Registration
   * with an email that already exists globally is rejected outright (no
   * silent attach to an existing account); the same is true for an
   * already-used organization slug.
   */
  async register(dto: RegisterDto, context: RequestContext): Promise<RegisterResult> {
    const policyError = this.passwordService.validatePolicy(dto.password);
    if (policyError !== undefined) {
      throw new BadRequestException(policyError);
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const db = this.databaseService.getClient();

    const { user, organization, session, refreshToken } = await db
      .$transaction(async (tx) => {
        const existingUser = await tx.user.findUnique({ where: { email: dto.email } });
        if (existingUser !== null) {
          throw new ConflictException('An account with this email already exists.');
        }

        const existingOrganization = await tx.organization.findUnique({
          where: { slug: dto.organizationSlug },
        });
        if (existingOrganization !== null) {
          throw new ConflictException('This organization slug is already in use.');
        }

        const organization = await tx.organization.create({
          data: {
            name: dto.organizationName,
            slug: dto.organizationSlug,
            type: 'BUSINESS',
            status: 'ACTIVE',
            defaultCurrency: dto.defaultCurrency,
            countryCode: dto.countryCode,
            timezone: dto.timezone,
          },
        });

        const user = await tx.user.create({
          data: {
            email: dto.email,
            status: 'ACTIVE',
            ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
          },
        });

        await tx.userCredential.create({ data: { userId: user.id, passwordHash } });

        await tx.organizationMembership.create({
          data: { organizationId: organization.id, userId: user.id, role: 'OWNER' },
        });

        const { session, refreshToken } = await this.sessionService.createSession(
          user.id,
          context,
          tx,
        );

        await this.auditService.write(tx, {
          organizationId: organization.id,
          actor: { type: 'USER', userId: user.id },
          action: AUDIT_ACTIONS.AUTH_REGISTERED,
          resource: { type: AUDIT_RESOURCE_TYPES.USER, id: user.id },
          requestContext: context,
          metadata: { organizationSlug: organization.slug, role: 'OWNER' },
        });

        return { user, organization, session, refreshToken };
      })
      .catch((error: unknown) => {
        if (error instanceof ConflictException) throw error;
        if (isUniqueConstraintViolation(error)) {
          throw new ConflictException('This email or organization slug is already in use.');
        }
        throw error;
      });

    const accessToken = this.accessTokenService.issue({
      userId: user.id,
      sessionId: session.id,
      email: user.email,
    });

    return { accessToken, refreshToken, user, organization, session };
  }

  /**
   * Always returns the same generic "invalid email or password" failure
   * for an unknown email, a suspended user, or a wrong password — and
   * always performs a real (or dummy) Argon2id verify on every path, so
   * response timing does not distinguish them (see `PasswordService`).
   */
  async login(dto: LoginDto, context: RequestContext): Promise<AuthResult> {
    const db = this.databaseService.getClient();
    const user = await db.user.findUnique({
      where: { email: dto.email },
      include: { credential: true },
    });

    if (user === null || user.credential === null || user.status !== 'ACTIVE') {
      await this.passwordService.verifyDummy(dto.password);
      throw new UnauthorizedException('Invalid email or password.');
    }

    const { credential, ...safeUser } = user;
    const passwordValid = await this.passwordService.verify(credential.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (this.passwordService.needsRehash(credential.passwordHash)) {
      const rehashed = await this.passwordService.hash(dto.password);
      await db.userCredential.update({
        where: { userId: user.id },
        data: { passwordHash: rehashed, passwordChangedAt: new Date() },
      });
    }

    const { session, refreshToken } = await this.sessionService.createSession(user.id, context);
    const accessToken = this.accessTokenService.issue({
      userId: user.id,
      sessionId: session.id,
      email: user.email,
    });

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const organizationId = await this.resolveAuditOrganizationId(user.id);
    if (organizationId !== undefined) {
      await this.auditService.write(this.databaseService.getClient(), {
        organizationId,
        actor: { type: 'USER', userId: user.id },
        action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCEEDED,
        resource: { type: AUDIT_RESOURCE_TYPES.USER, id: user.id },
        requestContext: context,
      });
    }

    return { accessToken, refreshToken, user: safeUser, session };
  }

  async refresh(refreshToken: string, context: RequestContext): Promise<RefreshResult> {
    const { session, refreshToken: newRefreshToken } = await this.sessionService.rotateSession(
      refreshToken,
      context,
    );

    const user = await this.databaseService
      .getClient()
      .user.findUnique({ where: { id: session.userId } });
    if (user === null) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const accessToken = this.accessTokenService.issue({
      userId: user.id,
      sessionId: session.id,
      email: user.email,
    });

    return { accessToken, refreshToken: newRefreshToken, session };
  }

  async logout(principal: UserPrincipal, context: RequestContext): Promise<void> {
    await this.sessionService.revokeSession(
      principal.sessionId,
      { type: 'USER', userId: principal.userId },
      context,
    );
  }

  async logoutAll(principal: UserPrincipal, context: RequestContext): Promise<void> {
    await this.sessionService.revokeAllSessions(
      principal.userId,
      { type: 'USER', userId: principal.userId },
      context,
    );
  }

  async me(principal: UserPrincipal): Promise<MeResult> {
    const db = this.databaseService.getClient();
    const [user, memberships, session] = await Promise.all([
      db.user.findUnique({ where: { id: principal.userId } }),
      db.organizationMembership.findMany({
        where: { userId: principal.userId },
        include: { organization: true },
      }),
      this.sessionService.getSession(principal.sessionId),
    ]);

    if (user === null || session === null) {
      throw new UnauthorizedException('Session is no longer active.');
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status,
        createdAt: user.createdAt,
      },
      memberships: memberships.map((membership) => ({
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        organizationSlug: membership.organization.slug,
        role: membership.role,
      })),
      session: { id: session.id, expiresAt: session.expiresAt },
    };
  }

  /** Backs the diagnostic `GET /auth/context` route. Purely synchronous: role/org/scopes were already resolved by upstream guards. */
  context(principal: Principal, organizationContext: OrganizationContext): AuthContextResult {
    if (principal.type === 'USER') {
      return {
        principalType: 'USER',
        organizationId: organizationContext.organizationId,
        role: organizationContext.role,
      };
    }

    return {
      principalType: 'API_KEY',
      organizationId: organizationContext.organizationId,
      environment: principal.environment,
      scopes: principal.scopes,
    };
  }

  private async resolveAuditOrganizationId(userId: string): Promise<string | undefined> {
    const membership = await this.memberships.findSoleMembership(userId);
    return membership?.organizationId;
  }
}
