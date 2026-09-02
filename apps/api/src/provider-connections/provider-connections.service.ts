import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  IdempotencyRecordStatus,
  ProviderAccountConnectionStatus,
  type IdempotencyRecord,
  type Prisma,
  type ProviderAccountConnection,
} from '@fraterunion-payments/database';
import { createProviderAccountReference } from '@fraterunion-payments/provider-contracts';
import type { ProviderAccountObservation } from '@fraterunion-payments/provider-stripe';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, type AuditActor } from '../audit/audit.types';
import type { RequestContext } from '../auth/types/request-context.type';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import { parseApiIdempotencyKey } from '../idempotency/idempotency';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { isIdempotencyUnique } from '../idempotency/idempotency.exceptions';
import { deriveProviderIdempotencyKey } from '../idempotency/provider-idempotency-key';
import { IDEMPOTENCY_RESOURCE_TYPES, IDEMPOTENCY_SCOPES } from '../idempotency/idempotency.types';
import { providerAccountCreateFingerprint } from './provider-connection-idempotency';
import {
  ProviderConfigurationException,
  ProviderConnectionAlreadyExistsException,
  ProviderConnectionCreateInProgressException,
  ProviderConnectionNotFoundException,
  ProviderOnboardingLinkFailedException,
  mapConnectProviderError,
  mapProviderConnectionPrismaError,
} from './provider-connection.exceptions';
import {
  STRIPE_PROVIDER,
  type CreateStripeProviderConnectionInput,
  type ProviderConnectionResponse,
} from './provider-connection.types';
import { STRIPE_CONNECT_PROVIDER, type StripeConnectProviderPort } from './stripe-connect.tokens';

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class ProviderAccountConnectionService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly logger: PinoLogger,
    private readonly idempotency: IdempotencyService,
    private readonly config: AppConfigService,
    @Inject(STRIPE_CONNECT_PROVIDER) private readonly stripeConnect: StripeConnectProviderPort,
  ) {
    this.logger.setContext(ProviderAccountConnectionService.name);
  }

  async createStripe(
    input: CreateStripeProviderConnectionInput,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<ProviderAccountConnection> {
    this.assertStripeEnabled();
    const { keyHash } = parseApiIdempotencyKey(input.idempotencyKey);
    const fingerprint = providerAccountCreateFingerprint(input.organizationId);
    const db = this.databaseService.getClient();

    const existing = await this.idempotency.findExisting(db, {
      organizationId: input.organizationId,
      scope: IDEMPOTENCY_SCOPES.PROVIDER_ACCOUNT_CREATE,
      keyHash,
    });
    if (existing !== null) {
      this.idempotency.assertFingerprint(existing, fingerprint);
      if (existing.status === IdempotencyRecordStatus.COMPLETED) {
        return this.get(input.organizationId, existing.resourceId);
      }
      return this.provisionAfterReserve(existing, actor, requestContext);
    }

    let reserved: IdempotencyRecord;
    try {
      reserved = await db.$transaction(async (tx) => {
        await this.lockOrganization(tx, input.organizationId);
        const duplicate = await tx.providerAccountConnection.findUnique({
          where: {
            organizationId_provider: {
              organizationId: input.organizationId,
              provider: STRIPE_PROVIDER,
            },
          },
        });
        if (duplicate !== null) {
          throw new ProviderConnectionAlreadyExistsException();
        }
        const inFlight = await tx.idempotencyRecord.findFirst({
          where: {
            organizationId: input.organizationId,
            scope: IDEMPOTENCY_SCOPES.PROVIDER_ACCOUNT_CREATE,
            status: IdempotencyRecordStatus.IN_PROGRESS,
          },
        });
        if (inFlight !== null) {
          if (inFlight.keyHash === keyHash) {
            return inFlight;
          }
          throw new ProviderConnectionCreateInProgressException();
        }
        return this.idempotency.reserveInProgress(tx, {
          organizationId: input.organizationId,
          scope: IDEMPOTENCY_SCOPES.PROVIDER_ACCOUNT_CREATE,
          keyHash,
          requestFingerprint: fingerprint,
          resourceType: IDEMPOTENCY_RESOURCE_TYPES.CONNECTION,
          resourceId: randomUUID(),
        });
      });
    } catch (error) {
      if (
        error instanceof ProviderConnectionAlreadyExistsException ||
        error instanceof ProviderConnectionCreateInProgressException
      ) {
        throw error;
      }
      if (isIdempotencyUnique(error)) {
        const raced = await this.idempotency.findExisting(db, {
          organizationId: input.organizationId,
          scope: IDEMPOTENCY_SCOPES.PROVIDER_ACCOUNT_CREATE,
          keyHash,
        });
        if (raced !== null) {
          this.idempotency.assertFingerprint(raced, fingerprint);
          if (raced.status === IdempotencyRecordStatus.COMPLETED) {
            return this.get(input.organizationId, raced.resourceId);
          }
          return this.provisionAfterReserve(raced, actor, requestContext);
        }
      }
      throw mapProviderConnectionPrismaError(error) ?? error;
    }

    return this.provisionAfterReserve(reserved, actor, requestContext);
  }

  async list(organizationId: string): Promise<readonly ProviderAccountConnection[]> {
    return this.databaseService.getClient().providerAccountConnection.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(organizationId: string, connectionId: string): Promise<ProviderAccountConnection> {
    const connection = await this.databaseService.getClient().providerAccountConnection.findFirst({
      where: { id: connectionId, organizationId },
    });
    if (connection === null) {
      throw new ProviderConnectionNotFoundException();
    }
    return connection;
  }

  async createOnboardingLink(
    organizationId: string,
    connectionId: string,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<{ readonly url: string; readonly expiresAt?: Date }> {
    this.assertStripeEnabled();
    const returnUrl = this.config.stripeConnectReturnUrl;
    const refreshUrl = this.config.stripeConnectRefreshUrl;
    if (returnUrl === undefined || refreshUrl === undefined) {
      throw new ProviderConfigurationException();
    }
    const connection = await this.get(organizationId, connectionId);
    let link;
    try {
      link = await this.stripeConnect.createHostedOnboardingLink({
        providerAccountReference: createProviderAccountReference({
          provider: connection.provider,
          id: connection.providerAccountId,
        }),
        returnUrl,
        refreshUrl,
      });
    } catch (error) {
      throw mapConnectProviderError(error) ?? new ProviderOnboardingLinkFailedException();
    }

    const db = this.databaseService.getClient();
    await db.$transaction(async (tx) => {
      await this.auditService.write(tx, {
        organizationId,
        actor,
        action: AUDIT_ACTIONS.PROVIDER_CONNECTION_ONBOARDING_LINK_CREATED,
        resource: {
          type: AUDIT_RESOURCE_TYPES.PROVIDER_ACCOUNT_CONNECTION,
          id: connection.id,
        },
        ...(requestContext !== undefined ? { requestContext } : {}),
        metadata: {
          connectionId: connection.id,
          provider: connection.provider,
        },
      });
    });
    this.logger.info(
      { connectionId: connection.id, provider: connection.provider },
      'Provider onboarding link created',
    );
    return link.expiresAt === undefined
      ? { url: link.url }
      : { url: link.url, expiresAt: link.expiresAt };
  }

  async refresh(
    organizationId: string,
    connectionId: string,
    actor: AuditActor,
    requestContext?: RequestContext,
  ): Promise<ProviderAccountConnection> {
    this.assertStripeEnabled();
    const connection = await this.get(organizationId, connectionId);
    let observation: ProviderAccountObservation;
    try {
      observation = await this.stripeConnect.retrieveConnectedAccount({
        providerAccountReference: createProviderAccountReference({
          provider: connection.provider,
          id: connection.providerAccountId,
        }),
      });
    } catch (error) {
      throw mapConnectProviderError(error) ?? error;
    }

    const db = this.databaseService.getClient();
    try {
      return await db.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT 1 FROM provider_account_connections
          WHERE id = ${connectionId}::uuid AND organization_id = ${organizationId}::uuid
          FOR UPDATE`;
        const locked = await tx.providerAccountConnection.findFirst({
          where: { id: connectionId, organizationId },
        });
        if (locked === null) {
          throw new ProviderConnectionNotFoundException();
        }
        const updated = await tx.providerAccountConnection.update({
          where: { id: locked.id },
          data: {
            status: toPersistedStatus(observation.status),
            paymentsEnabled: observation.paymentsEnabled,
            payoutsEnabled: observation.payoutsEnabled,
            requirementsDue: observation.requirementsDue,
          },
        });
        const statusChanged = readinessChanged(locked, updated);
        await this.auditService.write(tx, {
          organizationId,
          actor,
          action: AUDIT_ACTIONS.PROVIDER_CONNECTION_REFRESHED,
          resource: {
            type: AUDIT_RESOURCE_TYPES.PROVIDER_ACCOUNT_CONNECTION,
            id: updated.id,
          },
          ...(requestContext !== undefined ? { requestContext } : {}),
          metadata: safeConnectionMetadata(updated),
        });
        if (statusChanged) {
          await this.auditService.write(tx, {
            organizationId,
            actor,
            action: AUDIT_ACTIONS.PROVIDER_CONNECTION_STATUS_CHANGED,
            resource: {
              type: AUDIT_RESOURCE_TYPES.PROVIDER_ACCOUNT_CONNECTION,
              id: updated.id,
            },
            ...(requestContext !== undefined ? { requestContext } : {}),
            metadata: {
              ...safeConnectionMetadata(updated),
              previousStatus: locked.status,
            },
          });
        }
        return updated;
      });
    } catch (error) {
      if (error instanceof ProviderConnectionNotFoundException) {
        throw error;
      }
      throw mapProviderConnectionPrismaError(error) ?? error;
    }
  }

  private async provisionAfterReserve(
    operation: IdempotencyRecord,
    actor: AuditActor,
    requestContext: RequestContext | undefined,
  ): Promise<ProviderAccountConnection> {
    const db = this.databaseService.getClient();
    const organization = await db.organization.findFirst({
      where: { id: operation.organizationId },
    });
    if (organization === null) {
      throw new ProviderConfigurationException();
    }

    let observation: ProviderAccountObservation;
    try {
      observation = await this.stripeConnect.createConnectedAccount({
        displayName: organization.name,
        country: organization.countryCode,
        defaultCurrency: organization.defaultCurrency,
        idempotencyKey: deriveProviderIdempotencyKey({
          provider: STRIPE_PROVIDER,
          operation: IDEMPOTENCY_SCOPES.PROVIDER_ACCOUNT_CREATE,
          operationId: operation.id,
        }),
      });
    } catch (error) {
      throw mapConnectProviderError(error) ?? error;
    }

    try {
      return await db.$transaction(async (tx) => {
        const current = await tx.idempotencyRecord.findFirst({
          where: { id: operation.id, organizationId: operation.organizationId },
        });
        if (current === null) {
          throw new ProviderConfigurationException();
        }
        if (current.status === IdempotencyRecordStatus.COMPLETED) {
          return this.getInTransaction(tx, operation.organizationId, current.resourceId);
        }
        const existingRow = await tx.providerAccountConnection.findFirst({
          where: { id: current.resourceId, organizationId: operation.organizationId },
        });
        if (existingRow !== null) {
          await this.idempotency.complete(tx, {
            organizationId: operation.organizationId,
            operationId: current.id,
          });
          return existingRow;
        }
        const created = await tx.providerAccountConnection.create({
          data: {
            id: current.resourceId,
            organizationId: operation.organizationId,
            provider: STRIPE_PROVIDER,
            providerAccountId: observation.providerAccountReference.id,
            status: toPersistedStatus(observation.status),
            paymentsEnabled: observation.paymentsEnabled,
            payoutsEnabled: observation.payoutsEnabled,
            requirementsDue: observation.requirementsDue,
          },
        });
        await this.auditService.write(tx, {
          organizationId: operation.organizationId,
          actor,
          action: AUDIT_ACTIONS.PROVIDER_CONNECTION_CREATED,
          resource: {
            type: AUDIT_RESOURCE_TYPES.PROVIDER_ACCOUNT_CONNECTION,
            id: created.id,
          },
          ...(requestContext !== undefined ? { requestContext } : {}),
          metadata: safeConnectionMetadata(created),
        });
        await this.idempotency.complete(tx, {
          organizationId: operation.organizationId,
          operationId: current.id,
        });
        this.logger.info(
          { connectionId: created.id, provider: created.provider, status: created.status },
          'Provider connection created',
        );
        return created;
      });
    } catch (error) {
      throw mapProviderConnectionPrismaError(error) ?? error;
    }
  }

  private async getInTransaction(
    tx: TransactionClient,
    organizationId: string,
    connectionId: string,
  ): Promise<ProviderAccountConnection> {
    const connection = await tx.providerAccountConnection.findFirst({
      where: { id: connectionId, organizationId },
    });
    if (connection === null) {
      throw new ProviderConnectionNotFoundException();
    }
    return connection;
  }

  private async lockOrganization(tx: TransactionClient, organizationId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT 1 FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
  }

  private assertStripeEnabled(): void {
    if (!this.config.stripeEnabled) {
      throw new ProviderConfigurationException();
    }
  }
}

export function toProviderConnectionResponse(
  connection: ProviderAccountConnection,
): ProviderConnectionResponse {
  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    paymentsEnabled: connection.paymentsEnabled,
    payoutsEnabled: connection.payoutsEnabled,
    requirementsDue: connection.requirementsDue,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function toPersistedStatus(status: string): ProviderAccountConnectionStatus {
  switch (status) {
    case ProviderAccountConnectionStatus.PENDING:
    case ProviderAccountConnectionStatus.REQUIRES_ACTION:
    case ProviderAccountConnectionStatus.ACTIVE:
    case ProviderAccountConnectionStatus.RESTRICTED:
    case ProviderAccountConnectionStatus.DISCONNECTED:
      return status;
    default:
      throw new ProviderConfigurationException();
  }
}

function readinessChanged(
  before: ProviderAccountConnection,
  after: ProviderAccountConnection,
): boolean {
  return (
    before.status !== after.status ||
    before.paymentsEnabled !== after.paymentsEnabled ||
    before.payoutsEnabled !== after.payoutsEnabled ||
    before.requirementsDue !== after.requirementsDue
  );
}

function safeConnectionMetadata(connection: ProviderAccountConnection): Record<string, unknown> {
  return {
    connectionId: connection.id,
    provider: connection.provider,
    status: connection.status,
    paymentsEnabled: connection.paymentsEnabled,
    payoutsEnabled: connection.payoutsEnabled,
    requirementsDue: connection.requirementsDue,
  };
}
