import { ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerStatus } from '@fraterunion-payments/database';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CUSTOMER_LIST_DEFAULT_LIMIT, CUSTOMER_LIST_MAX_LIMIT } from '../customer.types';

export class ListCustomersQueryDto {
  @ApiPropertyOptional({ enum: CustomerStatus, description: 'Defaults to ACTIVE.' })
  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @ApiPropertyOptional({
    description: 'Case-insensitive search over name, email, externalReference.',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ default: CUSTOMER_LIST_DEFAULT_LIMIT, maximum: CUSTOMER_LIST_MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CUSTOMER_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    description: 'ISO-8601 createdAt of the last item from the previous page.',
  })
  @IsOptional()
  @IsString()
  cursorCreatedAt?: string;

  @ApiPropertyOptional({ description: 'Customer id of the last item from the previous page.' })
  @IsOptional()
  @IsString()
  cursorId?: string;
}
