/**
 * The claims carried by an access JWT, matching what
 * `AccessTokenService.issue` signs and `AccessTokenService.verify` checks.
 * Deliberately minimal — no memberships, roles, or scopes are embedded, so
 * a token never goes stale relative to a role/membership change made after
 * it was issued (see docs/architecture/authentication-and-access-control.md).
 */
export interface AccessTokenPayload {
  /** Subject: the authenticated user's id. */
  readonly sub: string;
  /** The backing `Session.id` this token was issued for. */
  readonly sid: string;
  readonly email?: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
  readonly aud: string;
}
