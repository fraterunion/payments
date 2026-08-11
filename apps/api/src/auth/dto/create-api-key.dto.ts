import { ApiProperty } from '@nestjs/swagger';
import { ApiEnvironment } from '@fraterunion-payments/database';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { API_KEY_SCOPES, type ApiKeyScope } from '../../common/constants/api-key-scopes.constants';

const NAME_MAX_LENGTH = 160;

export class CreateApiKeyDto {
  @ApiProperty({ example: 'CI deploy key' })
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({ enum: ApiEnvironment })
  @IsEnum(ApiEnvironment)
  environment!: ApiEnvironment;

  @ApiProperty({ enum: API_KEY_SCOPES, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn([...API_KEY_SCOPES], { each: true })
  scopes!: ApiKeyScope[];

  @ApiProperty({ required: false, description: 'ISO 8601 timestamp. Omit for a non-expiring key.' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
