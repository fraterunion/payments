const MAX_ERROR_MESSAGE_LENGTH = 512;

const SECRET_PATTERNS: readonly RegExp[] = [
  /postgresql:\/\/[^\s]+/gi,
  /postgres:\/\/[^\s]+/gi,
  /bearer\s+[a-z0-9._~+/=-]+/gi,
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  /fup_(?:test|live)_[0-9a-f]+_[A-Za-z0-9_-]+/g,
  /password[=:]\s*\S+/gi,
  /secret[=:]\s*\S+/gi,
];

/**
 * Bounded, redacted operational error summary for persistence.
 * Never includes a stack trace. Strips connection strings, JWTs, API keys,
 * and obvious secret assignments.
 */
export function sanitizeErrorMessage(error: unknown): string {
  const raw = extractMessage(error);
  const withoutStack = raw.split('\n')[0] ?? '';
  let sanitized = withoutStack;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  sanitized = sanitized.trim();
  if (sanitized.length === 0) {
    return 'An unexpected error occurred.';
  }
  return sanitized.length > MAX_ERROR_MESSAGE_LENGTH
    ? sanitized.slice(0, MAX_ERROR_MESSAGE_LENGTH)
    : sanitized;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unexpected error occurred.';
}
