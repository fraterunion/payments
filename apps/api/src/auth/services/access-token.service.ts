import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { AppConfigService } from '../../config/app-config.service';

const SIGNING_ALGORITHM = 'HS256' as const;

export interface IssueAccessTokenInput {
  readonly userId: string;
  readonly sessionId: string;
  readonly email: string;
}

export interface VerifiedAccessToken {
  readonly userId: string;
  readonly sessionId: string;
  readonly email?: string;
}

/**
 * Issues and verifies short-lived, stateless access JWTs. Access JWTs are
 * never stored anywhere (see `Session` in `packages/database/prisma/schema.prisma`)
 * — verification is purely cryptographic plus, at the guard layer, a
 * lookup of the session named by the `sid` claim.
 *
 * Symmetric (HS256) signing for v1 — see
 * docs/architecture/authentication-and-access-control.md for the tradeoff
 * against asymmetric signing and how this would move to it later. The
 * algorithm is pinned explicitly on both `sign` and `verify` (never left to
 * a default or a token-supplied `alg` header), which is what closes the
 * classic "algorithm confusion" attack — a caller cannot present a token
 * signed with `none` or a different algorithm and have it accepted.
 */
@Injectable()
export class AccessTokenService {
  constructor(private readonly appConfig: AppConfigService) {}

  issue(input: IssueAccessTokenInput): string {
    return jwt.sign({ sid: input.sessionId, email: input.email }, this.appConfig.jwtAccessSecret, {
      algorithm: SIGNING_ALGORITHM,
      subject: input.userId,
      issuer: this.appConfig.jwtAccessIssuer,
      audience: this.appConfig.jwtAccessAudience,
      expiresIn: this.appConfig.jwtAccessTtlSeconds,
    });
  }

  /**
   * Throws (a raw `jsonwebtoken` error — `TokenExpiredError`,
   * `JsonWebTokenError`, etc.) on any invalid, expired, malformed, or
   * wrong-issuer/audience/algorithm token. Deliberately does not catch and
   * translate here: this service is a plain crypto/domain utility, not a
   * framework concern, so translating to a generic "unauthorized" HTTP
   * response is the calling guard's job.
   */
  verify(token: string): VerifiedAccessToken {
    const decoded = jwt.verify(token, this.appConfig.jwtAccessSecret, {
      algorithms: [SIGNING_ALGORITHM],
      issuer: this.appConfig.jwtAccessIssuer,
      audience: this.appConfig.jwtAccessAudience,
    });

    if (typeof decoded === 'string') {
      throw new jwt.JsonWebTokenError('Unexpected access token payload shape.');
    }

    const { sub, sid, email } = decoded;
    if (typeof sub !== 'string' || typeof sid !== 'string') {
      throw new jwt.JsonWebTokenError('Access token is missing required claims.');
    }

    return {
      userId: sub,
      sessionId: sid,
      ...(typeof email === 'string' ? { email } : {}),
    };
  }
}
