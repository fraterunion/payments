import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppConfigService } from '../../config/app-config.service';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/**
 * A password used only to pay the cost of an Argon2id verify when no real
 * credential exists to compare against (unknown email at login). Never
 * derived from user input and never a valid password for any real account.
 */
const TIMING_SAFETY_DUMMY_PASSWORD = 'fraterunion-payments-dummy-verify-subject';

/**
 * Centralizes Argon2id password hashing so every call site uses the same,
 * explicitly configured parameters (see `PASSWORD_ARGON2_*` environment
 * variables and docs/architecture/authentication-and-access-control.md) —
 * never the library's silent defaults. `argon2id` is the only mode used:
 * it resists both GPU cracking (memory-hardness) and side-channel attacks,
 * the reason it is recommended over `argon2i`/`argon2d` for password
 * storage.
 */
@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  constructor(private readonly appConfig: AppConfigService) {}

  private get hashOptions(): argon2.HashOptions {
    return {
      type: argon2.argon2id,
      memoryCost: this.appConfig.passwordArgon2MemoryKib,
      timeCost: this.appConfig.passwordArgon2TimeCost,
      parallelism: this.appConfig.passwordArgon2Parallelism,
    };
  }

  /**
   * Registration-time policy check (more descriptive errors are acceptable
   * here — see `docs/architecture/authentication-and-access-control.md`).
   * No composition rules (no mandatory symbols/uppercase/digits): length is
   * the only enforced property, so passphrases are fully permitted. No
   * trimming or other normalization is applied to the password itself.
   */
  validatePolicy(password: string): string | undefined {
    if (password.length < PASSWORD_MIN_LENGTH) {
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
    }
    return undefined;
  }

  async hash(password: string): Promise<string> {
    return argon2.hash(password, this.hashOptions);
  }

  /**
   * As far as practical for a JS/native-addon boundary: argon2's verify
   * always performs the full hash computation before comparing, so
   * verification time depends only on the configured cost parameters, not
   * on where the password first differs from the stored hash. This does
   * not claim full elimination of every timing side channel (e.g. network
   * jitter, GC pauses) — only that the comparison itself is not
   * short-circuiting.
   */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, this.hashOptions);
  }

  /**
   * Performs a real Argon2id verify against a fixed, never-matching hash so
   * that a login attempt for a non-existent email takes roughly as long as
   * one for a real email with a wrong password — mitigating account
   * enumeration via response-time differences. Hashed lazily, once, using
   * this process's configured cost parameters (not a hardcoded string), so
   * the timing genuinely matches real verifies.
   */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash(TIMING_SAFETY_DUMMY_PASSWORD);
    const hash = await this.dummyHash;
    await this.verify(hash, password);
  }
}
