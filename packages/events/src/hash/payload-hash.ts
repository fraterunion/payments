import { createHash } from 'node:crypto';
import { canonicalizeJson } from '../json/canonical-json.js';

/** SHA-256 hex digest of the canonical JSON representation. */
export function hashPayload(value: unknown): string {
  return createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex');
}
