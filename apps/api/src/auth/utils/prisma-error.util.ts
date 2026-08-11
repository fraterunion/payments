import { Prisma } from '@fraterunion-payments/database';

/** True for a Postgres unique-constraint violation surfaced through Prisma (error code `P2002`). */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
