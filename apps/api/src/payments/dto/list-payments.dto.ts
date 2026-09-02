import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentCaptureMethod, PaymentStatus } from '@fraterunion-payments/database';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { PAYMENT_LIST_DEFAULT_LIMIT, PAYMENT_LIST_MAX_LIMIT } from '../payment.types';

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: PaymentCaptureMethod })
  @IsOptional()
  @IsEnum(PaymentCaptureMethod)
  captureMethod?: PaymentCaptureMethod;

  @ApiPropertyOptional({ description: 'Inclusive createdAt lower bound (ISO-8601).' })
  @IsOptional()
  @IsISO8601()
  createdAtFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive createdAt upper bound (ISO-8601).' })
  @IsOptional()
  @IsISO8601()
  createdAtTo?: string;

  @ApiPropertyOptional({ default: PAYMENT_LIST_DEFAULT_LIMIT, maximum: PAYMENT_LIST_MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAYMENT_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    description: 'ISO-8601 createdAt of the last item from the previous page.',
  })
  @IsOptional()
  @IsString()
  cursorCreatedAt?: string;

  @ApiPropertyOptional({ description: 'Payment id of the last item from the previous page.' })
  @IsOptional()
  @IsString()
  cursorId?: string;
}
