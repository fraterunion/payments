import type { ErrorCode } from '../constants/error-codes.constants';

export interface ErrorDetail {
  readonly field: string;
  readonly message: string;
}

export interface ErrorEnvelope {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details?: readonly ErrorDetail[];
    readonly requestId: string;
  };
}
