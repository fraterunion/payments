import { ApiPropertyOptional } from '@nestjs/swagger';
import { RefundReason, RefundStatus } from '@fraterunion-payments/database';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { REFUND_LIST_DEFAULT_LIMIT, REFUND_LIST_MAX_LIMIT } from '../refund.types';

export class ListRefundsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  paymentId?: string;

  @ApiPropertyOptional({ enum: RefundStatus })
  @IsOptional()
  @IsEnum(RefundStatus)
  status?: RefundStatus;

  @ApiPropertyOptional({ enum: RefundReason })
  @IsOptional()
  @IsEnum(RefundReason)
  reason?: RefundReason;

  @ApiPropertyOptional({ description: 'Inclusive createdAt lower bound (ISO-8601).' })
  @IsOptional()
  @IsISO8601()
  createdAtFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive createdAt upper bound (ISO-8601).' })
  @IsOptional()
  @IsISO8601()
  createdAtTo?: string;

  @ApiPropertyOptional({ default: REFUND_LIST_DEFAULT_LIMIT, maximum: REFUND_LIST_MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REFUND_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    description: 'ISO-8601 createdAt of the last item from the previous page.',
  })
  @IsOptional()
  @IsString()
  cursorCreatedAt?: string;

  @ApiPropertyOptional({ description: 'Refund id of the last item from the previous page.' })
  @IsOptional()
  @IsString()
  cursorId?: string;
}
