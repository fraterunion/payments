import { ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerType } from '@fraterunion-payments/database';
import { IsEnum, IsObject, IsOptional, IsString, Length } from 'class-validator';

export class CreateCustomerDto {
  @ApiPropertyOptional({ enum: CustomerType, default: CustomerType.INDIVIDUAL })
  @IsOptional()
  @IsEnum(CustomerType)
  type?: CustomerType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 320)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ description: 'E.164 phone number, e.g. +15551234567' })
  @IsOptional()
  @IsString()
  @Length(2, 16)
  phone?: string;

  @ApiPropertyOptional({ description: 'Tenant-owned integration reference. Not a provider ID.' })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  externalReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
