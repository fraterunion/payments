import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { ApiEnvironment, ApiKey } from '@fraterunion-payments/database';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, type AuditActor } from '../../audit/audit.types';
import { AppConfigService } from '../../config/app-config.service';
import { DatabaseService } from '../../database/database.service';
import type { AuthenticatedApiKey } from '../types/api-key-principal.type';
import type { RequestContext } from '../types/request-context.type';
import { generateApiKey, parseApiKey } from '../utils/api-key-format.util';
import { hashApiKeySecret } from '../utils/crypto.util';
import { isUniqueConstraintViolation } from '../utils/prisma-error.util';

const MAX_GENERATION_ATTEMPTS = 5;

export interface CreateApiKeyInput {
  readonly organizationId: string;
  readonly name: string;
  readonly environment: ApiEnvironment;
  readonly scopes: readonly string[];
  readonly createdByUserId: string;
  readonly expiresAt?: Date;
}

export interface CreatedApiKey {
  /** The full key value, e.g. `fup_test_...`. Shown to the caller exactly once; never persisted or logged. */
  readonly plaintextKey: string;
  readonly apiKey: ApiKey;
}

/**
 * Owns API-key generation, hashing, lookup, and revocation. See
 * `apps/api/src/auth/utils/api-key-format.util.ts` for the key format and
 * `apps/api/src/auth/utils/crypto.util.ts` for why `secretHash` uses a
 * keyed HMAC (not Argon2id — API keys are looked up by an exact,
 * deterministic hash match, the same pattern `Session.tokenHash` already
 * uses, not verified interactively like a password).
 */
@Injectable()
export class ApiKeyService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly appConfig: AppConfigService,
    private readonly auditService: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ApiKeyService.name);
  }

  async create(
    input: CreateApiKeyInput,
    actor: AuditActor,
    context: RequestContext,
  ): Promise<CreatedApiKey> {
    const db = this.databaseService.getClient();

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const generated = generateApiKey(input.environment);
      const secretHash = hashApiKeySecret(generated.secret, this.appConfig.apiKeyHashSecret);

      try {
        const apiKey = await db.$transaction(async (tx) => {
          const created = await tx.apiKey.create({
            data: {
              organizationId: input.organizationId,
              name: input.name,
              keyPrefix: generated.prefix,
              secretHash,
              status: 'ACTIVE',
              environment: input.environment,
              scopes: [...input.scopes],
              createdByUserId: input.createdByUserId,
              ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
            },
          });

          await this.auditService.record(
            {
              organizationId: input.organizationId,
              actor,
              action: AUDIT_ACTIONS.API_KEY_CREATED,
              resourceType: AUDIT_RESOURCE_TYPES.API_KEY,
              resourceId: created.id,
              metadata: {
                name: input.name,
                environment: input.environment,
                scopes: [...input.scopes],
                keyPrefix: generated.prefix,
              },
              ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
              ...(context.ipAddress !== undefined ? { ipAddress: context.ipAddress } : {}),
              ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
            },
            tx,
          );

          return created;
        });

        return { plaintextKey: generated.fullKey, apiKey };
      } catch (error) {
        if (isUniqueConstraintViolation(error) && attempt < MAX_GENERATION_ATTEMPTS) {
          this.logger.warn({ attempt }, 'API key prefix/secret collision, retrying generation.');
          continue;
        }
        throw error;
      }
    }

    // Unreachable: the loop above always either returns or throws.
    throw new Error('Failed to generate a unique API key after maximum attempts.');
  }

  async list(organizationId: string): Promise<ApiKey[]> {
    const db = this.databaseService.getClient();
    return db.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Scoped to `organizationId` so a cross-tenant id lookup returns `null`, never another org's key. */
  async findById(id: string, organizationId: string): Promise<ApiKey | null> {
    const db = this.databaseService.getClient();
    return db.apiKey.findFirst({ where: { id, organizationId } });
  }

  /** Idempotent: revoking an already-revoked (or nonexistent, or cross-tenant) key is a no-op. */
  async revoke(
    id: string,
    organizationId: string,
    actor: AuditActor,
    context: RequestContext,
  ): Promise<void> {
    const db = this.databaseService.getClient();
    const now = new Date();

    const result = await db.apiKey.updateMany({
      where: { id, organizationId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: now },
    });

    if (result.count === 0) return;

    await this.auditService.record({
      organizationId,
      actor,
      action: AUDIT_ACTIONS.API_KEY_REVOKED,
      resourceType: AUDIT_RESOURCE_TYPES.API_KEY,
      resourceId: id,
      ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
      ...(context.ipAddress !== undefined ? { ipAddress: context.ipAddress } : {}),
      ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
    });
  }

  /**
   * Authenticates a raw presented key value. Throws `UnauthorizedException`
   * with a generic message for every failure (malformed, unknown, revoked,
   * expired, or belonging to a suspended/closed organization) — never
   * reveals which.
   */
  async authenticate(rawKey: string): Promise<AuthenticatedApiKey> {
    const parsed = parseApiKey(rawKey);
    if (parsed === undefined) {
      throw new UnauthorizedException('Invalid API key.');
    }

    const db = this.databaseService.getClient();
    const secretHash = hashApiKeySecret(parsed.secret, this.appConfig.apiKeyHashSecret);
    const apiKey = await db.apiKey.findUnique({
      where: { secretHash },
      include: { organization: true },
    });

    if (apiKey === null) {
      throw new UnauthorizedException('Invalid API key.');
    }

    if (apiKey.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid API key.');
    }

    if (apiKey.expiresAt !== null && apiKey.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid API key.');
    }

    if (apiKey.organization.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid API key.');
    }

    this.touchLastUsed(apiKey.id);

    return {
      apiKeyId: apiKey.id,
      organizationId: apiKey.organizationId,
      environment: apiKey.environment,
      scopes: apiKey.scopes,
    };
  }

  /**
   * Fire-and-forget by design: `lastUsedAt` is a convenience diagnostic
   * field, not a correctness-critical one, so a failure here must never
   * fail the authenticated request it happened alongside.
   */
  private touchLastUsed(apiKeyId: string): void {
    const db = this.databaseService.getClient();
    db.apiKey
      .update({ where: { id: apiKeyId }, data: { lastUsedAt: new Date() } })
      .catch((error: unknown) => {
        this.logger.warn({ err: error, apiKeyId }, 'Failed to update API key lastUsedAt.');
      });
  }
}
