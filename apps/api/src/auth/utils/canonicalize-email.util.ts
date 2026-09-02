/**
 * Canonical email identity for FraterUnion Payments.
 *
 * The application writes this form on every register/login path. PostgreSQL
 * additionally enforces case-insensitive uniqueness on `users.email` (see
 * the `enforce_canonical_email_uniqueness` migration). This helper is the
 * single source of that application-side transform: trim surrounding
 * whitespace and lowercase. It does not remove dots, rewrite plus-aliases,
 * apply provider-specific rules, or Unicode-normalize beyond `toLowerCase`.
 */
export function canonicalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `class-transformer` `@Transform` adapter for {@link canonicalizeEmail}. */
export function canonicalizeEmailTransform({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? canonicalizeEmail(value) : value;
}
