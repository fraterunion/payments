import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../services/password.service';
import { canonicalizeEmailTransform } from '../utils/canonicalize-email.util';

const EMAIL_MAX_LENGTH = 320;

/**
 * Deliberately has no password minimum-length validation, unlike
 * `RegisterDto`. Login errors must not disclose password-policy internals
 * (see docs/architecture/authentication-and-access-control.md); an
 * intentionally-short password submitted at login simply fails the normal
 * credential check with the same generic "invalid credentials" response
 * as any other wrong password, rather than a distinct validation error
 * that would reveal the minimum length.
 */
export class LoginDto {
  @ApiProperty({ example: 'owner@example.com' })
  @Transform(canonicalizeEmailTransform)
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
