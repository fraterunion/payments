export const REQUEST_ID_HEADER = 'x-request-id';

/** Conservative bound; long headers are rejected rather than truncated. */
export const REQUEST_ID_MAX_LENGTH = 128;

/** Letters, numbers, dashes, underscores, and periods only. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
