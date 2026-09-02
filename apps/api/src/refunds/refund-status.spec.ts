import { RefundReason, RefundStatus } from '@fraterunion-payments/database';
import { REFUND_REASONS, REFUND_STATES } from '@fraterunion-payments/payment-core';
import {
  domainRefundReasons,
  domainRefundStates,
  persistedRefundReasons,
  persistedRefundStates,
  toDomainRefundReason,
  toDomainRefundStatus,
  toPersistedRefundReason,
  toPersistedRefundStatus,
} from './refund-status';

describe('refund status alignment', () => {
  it('maps every payment-core refund state to the Prisma enum and back', () => {
    expect([...persistedRefundStates()].sort()).toEqual([...Object.values(RefundStatus)].sort());
    expect([...domainRefundStates()].sort()).toEqual([...Object.values(REFUND_STATES)].sort());
    for (const state of domainRefundStates()) {
      expect(toDomainRefundStatus(toPersistedRefundStatus(state))).toBe(state);
    }
  });

  it('maps every payment-core refund reason to the Prisma enum and back', () => {
    expect([...persistedRefundReasons()].sort()).toEqual([...Object.values(RefundReason)].sort());
    expect([...domainRefundReasons()].sort()).toEqual([...Object.values(REFUND_REASONS)].sort());
    for (const reason of domainRefundReasons()) {
      expect(toDomainRefundReason(toPersistedRefundReason(reason))).toBe(reason);
    }
  });
});
