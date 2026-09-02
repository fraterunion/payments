import { fingerprintFinancialCommand } from '../idempotency/idempotency';
import { IDEMPOTENCY_SCOPES } from '../idempotency/idempotency.types';
import { STRIPE_PROVIDER } from './provider-connection.types';

export function providerAccountCreateFingerprint(organizationId: string): string {
  return fingerprintFinancialCommand({
    scope: IDEMPOTENCY_SCOPES.PROVIDER_ACCOUNT_CREATE,
    organizationId,
    request: { provider: STRIPE_PROVIDER },
  });
}
