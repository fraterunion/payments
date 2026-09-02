import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefundReason } from '@fraterunion-payments/database';
import { IsEnum, IsObject, IsOptional, IsString, Matches } from 'class-validator';

export class CreateRefundDto {
  @ApiProperty({
    description:
      'Integer minor units encoded as a decimal string. USD $50.00 → "5000". Currency is taken from the payment.',
    example: '5000',
  })
  @IsString()
  @Matches(/^[1-9][0-9]{0,18}$/, {
    message: 'amount must be a positive integer minor-unit decimal string',
  })
  amount!: string;

  @ApiPropertyOptional({ enum: RefundReason })
  @IsOptional()
  @IsEnum(RefundReason)
  reason?: RefundReason;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
