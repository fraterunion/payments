/**
 * Explicit classification for outbox/inbox handler failures.
 *
 * Do not infer retryability from message strings. Unexpected errors are
 * treated as retryable until the attempt budget is exhausted. Unknown
 * handlers and schema/validation incompatibilities are terminal.
 */
export class RetryableEventError extends Error {
  readonly code: string;
  readonly retryable = true as const;

  constructor(message: string, code = 'RETRYABLE') {
    super(message);
    this.name = 'RetryableEventError';
    this.code = code;
  }
}

export class TerminalEventError extends Error {
  readonly code: string;
  readonly retryable = false as const;

  constructor(message: string, code = 'TERMINAL') {
    super(message);
    this.name = 'TerminalEventError';
    this.code = code;
  }
}

export function isRetryableEventError(error: unknown): error is RetryableEventError {
  return error instanceof RetryableEventError;
}

export function isTerminalEventError(error: unknown): error is TerminalEventError {
  return error instanceof TerminalEventError;
}

export function isRetryableFailure(error: unknown): boolean {
  if (isTerminalEventError(error)) return false;
  if (isRetryableEventError(error)) return true;
  return true;
}

export function errorCodeOf(error: unknown): string {
  if (isRetryableEventError(error) || isTerminalEventError(error)) {
    return error.code;
  }
  return 'UNEXPECTED';
}
