import { Prisma } from '@fraterunion-payments/database';

/**
 * True for a PostgreSQL unique-constraint violation surfaced through Prisma
 * (`P2002`). Covers both Prisma-declared uniques (`users_email_key`) and
 * the SQL-only functional unique index `users_email_lower_uidx` — Prisma
 * reports both as `P2002`.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
