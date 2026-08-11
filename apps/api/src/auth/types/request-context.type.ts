/** Request-derived detail carried through to audit records. All optional: never required to authenticate or authorize. */
export interface RequestContext {
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly requestId?: string;
}
