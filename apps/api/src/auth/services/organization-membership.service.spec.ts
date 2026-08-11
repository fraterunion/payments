import type { DatabaseService } from '../../database/database.service';
import { OrganizationMembershipService } from './organization-membership.service';

function createFakeDb(findManyResult: unknown[]) {
  const client = {
    organizationMembership: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue(findManyResult),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any;
}

describe('OrganizationMembershipService', () => {
  describe('findSoleMembership', () => {
    it('returns the membership when the user has exactly one', async () => {
      const db = createFakeDb([{ organizationId: 'org-1' }]);
      const service = new OrganizationMembershipService({ getClient: () => db } as DatabaseService);

      await expect(service.findSoleMembership('user-1')).resolves.toEqual({
        organizationId: 'org-1',
      });
    });

    it('returns null when the user has no memberships', async () => {
      const db = createFakeDb([]);
      const service = new OrganizationMembershipService({ getClient: () => db } as DatabaseService);

      await expect(service.findSoleMembership('user-1')).resolves.toBeNull();
    });

    it('returns null when the user has more than one membership', async () => {
      const db = createFakeDb([{ organizationId: 'org-1' }, { organizationId: 'org-2' }]);
      const service = new OrganizationMembershipService({ getClient: () => db } as DatabaseService);

      await expect(service.findSoleMembership('user-1')).resolves.toBeNull();
    });
  });

  describe('findMembership', () => {
    it('queries by the composite organizationId_userId key', async () => {
      const db = createFakeDb([]);
      db.organizationMembership.findUnique.mockResolvedValue({ role: 'OWNER' });
      const service = new OrganizationMembershipService({ getClient: () => db } as DatabaseService);

      await service.findMembership('user-1', 'org-1');

      expect(db.organizationMembership.findUnique).toHaveBeenCalledWith({
        where: { organizationId_userId: { organizationId: 'org-1', userId: 'user-1' } },
      });
    });
  });
});
