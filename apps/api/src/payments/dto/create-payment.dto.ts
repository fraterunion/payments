import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentCaptureMethod } from '@fraterunion-payments/database';
import { IsEnum, IsObject, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { PAYMENT_DESCRIPTION_MAX_LENGTH } from '../payment.types';

export class CreatePaymentDto {
  @ApiPropertyOptional({
    description: 'Canonical FUP customer id. Must belong to this organization.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({
    description:
      'Integer minor units encoded as a decimal string. USD $125.00 → "12500". Not a decimal amount.',
    example: '12500',
  })
  @IsString()
  @Matches(/^[1-9][0-9]{0,18}$/, {
    message: 'amount must be a positive integer minor-unit decimal string',
  })
  amount!: string;

  @ApiProperty({
    example: 'USD',
    description: 'ISO 4217 currency code. Canonicalized to uppercase.',
  })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ enum: PaymentCaptureMethod })
  @IsEnum(PaymentCaptureMethod)
  captureMethod!: PaymentCaptureMethod;

  @ApiPropertyOptional({ maxLength: PAYMENT_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @Length(1, PAYMENT_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
