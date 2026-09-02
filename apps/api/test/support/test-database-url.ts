import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * Resolves `DATABASE_URL` for real-PostgreSQL suites. Loads the gitignored
 * `packages/database/.env` only when the variable is unset, so every suite
 * behaves the same regardless of which file Jest evaluates first.
 */
export function resolveDatabaseUrl(): string | undefined {
  if (process.env['DATABASE_URL'] === undefined) {
    for (const candidate of [
      resolve(__dirname, '../../../../packages/database/.env'),
      resolve(process.cwd(), '../../packages/database/.env'),
    ]) {
      if (existsSync(candidate)) {
        loadDotenv({ path: candidate });
        break;
      }
    }
  }
  return process.env['DATABASE_URL'];
}
