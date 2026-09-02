-- Canonical email uniqueness for `users.email`.
--
-- Application writes already store trim + lowercase emails. This migration
-- adds a PostgreSQL functional unique index so case-only variants cannot
-- coexist even if a write bypasses the application.
--
-- Prisma cannot declare expression indexes in schema.prisma. The byte-for-byte
-- `@unique` on `User.email` (`users_email_key`) is retained so Prisma can
-- `findUnique` / `upsert` by the canonical value. This index is complementary
-- defense in depth, not a replacement.
--
-- Existing-data safety: fail loudly if case-variant duplicates already exist.
-- This migration never merges users or deletes memberships, sessions,
-- credentials, or audits.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users"
    GROUP BY LOWER("email")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce canonical email uniqueness: existing users have case-variant duplicate emails. Resolve them manually before applying this migration. No records were merged or deleted.';
  END IF;
END $$;

CREATE UNIQUE INDEX "users_email_lower_uidx" ON "users" (LOWER("email"));
