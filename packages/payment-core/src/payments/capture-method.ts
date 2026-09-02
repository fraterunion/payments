export const CAPTURE_METHODS = {
  AUTOMATIC: 'AUTOMATIC',
  MANUAL: 'MANUAL',
} as const;

export type CaptureMethod = (typeof CAPTURE_METHODS)[keyof typeof CAPTURE_METHODS];
