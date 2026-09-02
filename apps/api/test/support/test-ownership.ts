/**
 * Reserved identity namespace for real-PostgreSQL fixtures.
 * Cleanup may delete rows in this namespace and must never match seed
 * data (`fraterunion` / `@fraterunion.local`).
 */
export const TEST_EMAIL_DOMAIN = 'fup.test';
export const TEST_SLUG_PREFIX = 'fup-test-';

/** Historical customer-e2e slugs left behind before mapping/customer deletes existed. */
export const LEGACY_TEST_SLUG_PREFIXES = ['cust-'] as const;

export const SEED_ORGANIZATION_SLUG = 'fraterunion';
export const SEED_EMAIL_DOMAIN = 'fraterunion.local';

export function testEmail(localPart: string): string {
  return `${localPart}@${TEST_EMAIL_DOMAIN}`;
}

export function testSlug(suffix: string): string {
  return `${TEST_SLUG_PREFIX}${suffix}`;
}

export function isProtectedSeedSlug(slug: string): boolean {
  return slug === SEED_ORGANIZATION_SLUG;
}

export function isProtectedSeedEmail(email: string): boolean {
  return email.endsWith(`@${SEED_EMAIL_DOMAIN}`);
}
