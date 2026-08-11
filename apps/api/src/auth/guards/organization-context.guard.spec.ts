import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { DatabaseService } from '../../database/database.service';
import type {
  AuthenticatedRequest,
  OrganizationScopedRequest,
} from '../types/authenticated-request.type';
import { OrganizationContextGuard } from './organization-context.guard';

const VALID_ORG_ID = '11111111-1111-1111-1111-111111111111';

function createContext(request: Partial<AuthenticatedRequest>): {
  context: ExecutionContext;
  request: Partial<AuthenticatedRequest>;
} {
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function createFakeDatabase(fns: {
  findOrganization?: jest.Mock;
  findMembership?: jest.Mock;
}): Pick<DatabaseService, 'getClient'> {
  return {
    getClient: () =>
      ({
        organization: { findUnique: fns.findOrganization ?? jest.fn() },
        organizationMembership: { findUnique: fns.findMembership ?? jest.fn() },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
  };
}

describe('OrganizationContextGuard', () => {
  it('rejects when no principal has been attached', async () => {
    const guard = new OrganizationContextGuard(createFakeDatabase({}) as DatabaseService);
    const { context } = createContext({ headers: {} });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a human request missing x-organization-id', async () => {
    const guard = new OrganizationContextGuard(createFakeDatabase({}) as DatabaseService);
    const { context } = createContext({
      headers: {},
      principal: { type: 'USER', userId: 'user-1', sessionId: 'session-1', email: 'a@example.com' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejects a human request with a malformed x-organization-id', async () => {
    const guard = new OrganizationContextGuard(createFakeDatabase({}) as DatabaseService);
    const { context } = createContext({
      headers: { 'x-organization-id': 'not-a-uuid' },
      principal: { type: 'USER', userId: 'user-1', sessionId: 'session-1', email: 'a@example.com' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the user has no membership in the requested organization (cross-tenant isolation)', async () => {
    const findMembership = jest.fn().mockResolvedValue(null);
    const guard = new OrganizationContextGuard(
      createFakeDatabase({ findMembership }) as DatabaseService,
    );
    const { context } = createContext({
      headers: { 'x-organization-id': VALID_ORG_ID },
      principal: { type: 'USER', userId: 'user-1', sessionId: 'session-1', email: 'a@example.com' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the membership exists but the organization is suspended', async () => {
    const findMembership = jest
      .fn()
      .mockResolvedValue({ role: 'OWNER', organization: { status: 'SUSPENDED' } });
    const guard = new OrganizationContextGuard(
      createFakeDatabase({ findMembership }) as DatabaseService,
    );
    const { context } = createContext({
      headers: { 'x-organization-id': VALID_ORG_ID },
      principal: { type: 'USER', userId: 'user-1', sessionId: 'session-1', email: 'a@example.com' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('resolves organization context with role for a valid human membership', async () => {
    const findMembership = jest
      .fn()
      .mockResolvedValue({ role: 'ADMIN', organization: { status: 'ACTIVE' } });
    const guard = new OrganizationContextGuard(
      createFakeDatabase({ findMembership }) as DatabaseService,
    );
    const { context, request } = createContext({
      headers: { 'x-organization-id': VALID_ORG_ID },
      principal: { type: 'USER', userId: 'user-1', sessionId: 'session-1', email: 'a@example.com' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((request as OrganizationScopedRequest).organizationContext).toEqual({
      organizationId: VALID_ORG_ID,
      role: 'ADMIN',
    });
  });

  it('resolves organization context from the API key principal, ignoring any x-organization-id header', async () => {
    const findOrganization = jest.fn().mockResolvedValue({ status: 'ACTIVE' });
    const guard = new OrganizationContextGuard(
      createFakeDatabase({ findOrganization }) as DatabaseService,
    );
    const { context, request } = createContext({
      headers: { 'x-organization-id': 'some-other-org-header-that-must-be-ignored' },
      principal: {
        type: 'API_KEY',
        apiKeyId: 'key-1',
        organizationId: 'org-key-1',
        environment: 'TEST',
        scopes: [],
      },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((request as OrganizationScopedRequest).organizationContext).toEqual({
      organizationId: 'org-key-1',
    });
    expect(findOrganization).toHaveBeenCalledWith({ where: { id: 'org-key-1' } });
  });

  it('rejects an API key principal bound to a suspended organization', async () => {
    const findOrganization = jest.fn().mockResolvedValue({ status: 'SUSPENDED' });
    const guard = new OrganizationContextGuard(
      createFakeDatabase({ findOrganization }) as DatabaseService,
    );
    const { context } = createContext({
      headers: {},
      principal: {
        type: 'API_KEY',
        apiKeyId: 'key-1',
        organizationId: 'org-key-1',
        environment: 'TEST',
        scopes: [],
      },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });
});
