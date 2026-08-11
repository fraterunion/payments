import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
  IsOptional,
  IsString,
  IsTimeZone,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../services/password.service';

const EMAIL_MAX_LENGTH = 320; // matches User.email @db.VarChar(320)
const DISPLAY_NAME_MAX_LENGTH = 160;
const ORGANIZATION_NAME_MAX_LENGTH = 200;
const SLUG_MIN_LENGTH = 3;
const SLUG_MAX_LENGTH = 63;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function trimAndLowercase({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function trimAndUppercase({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

/**
 * Creates a new BUSINESS organization and its first user (`OWNER`) in one
 * request. There is no way to request `type: INTERNAL` or an initial role
 * other than `OWNER` through this DTO — both are deliberate omissions, not
 * oversights (see docs/architecture/authentication-and-access-control.md).
 */
export class RegisterDto {
  @ApiProperty({ example: 'owner@example.com' })
  @Transform(trimAndLowercase)
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  /**
   * No composition rules (no mandatory uppercase/symbols) — length is the
   * only enforced property, so passphrases are fully permitted. Never
   * trimmed or otherwise normalized: a password's exact bytes are what get
   * hashed.
   */
  @ApiProperty({
    writeOnly: true,
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    example: 'a sufficiently long passphrase',
  })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiProperty({ required: false, maxLength: DISPLAY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

  @ApiProperty({ example: 'Acme Gym' })
  @IsString()
  @Length(1, ORGANIZATION_NAME_MAX_LENGTH)
  organizationName!: string;

  @ApiProperty({ example: 'acme-gym' })
  @Transform(trimAndLowercase)
  @Matches(SLUG_PATTERN, {
    message:
      'organizationSlug must contain only lowercase letters, digits, and single hyphens between segments.',
  })
  @Length(SLUG_MIN_LENGTH, SLUG_MAX_LENGTH)
  organizationSlug!: string;

  @ApiProperty({ example: 'USD', description: 'ISO 4217 currency code.' })
  @Transform(trimAndUppercase)
  @IsISO4217CurrencyCode()
  defaultCurrency!: string;

  @ApiProperty({ example: 'US', description: 'ISO 3166-1 alpha-2 country code.' })
  @Transform(trimAndUppercase)
  @IsISO31661Alpha2()
  countryCode!: string;

  @ApiProperty({ example: 'America/New_York', description: 'IANA timezone identifier.' })
  @IsTimeZone()
  timezone!: string;
}
