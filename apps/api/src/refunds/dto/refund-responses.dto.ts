import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentFailureCategory, RefundReason, RefundStatus } from '@fraterunion-payments/database';

export class RefundFailureResponseDto {
  @ApiProperty({ enum: PaymentFailureCategory })
  category!: PaymentFailureCategory;

  @ApiPropertyOptional()
  code?: string;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  retryable!: boolean;
}

export class RefundResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  paymentId!: string;

  @ApiProperty({ enum: RefundStatus })
  status!: RefundStatus;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: 'Integer minor units as a decimal string.' })
  amount!: string;

  @ApiPropertyOptional({ enum: RefundReason, nullable: true })
  reason!: RefundReason | null;

  @ApiPropertyOptional({ type: RefundFailureResponseDto, nullable: true })
  failure!: RefundFailureResponseDto | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  metadata!: Record<string, unknown>;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class RefundListResponseDto {
  @ApiProperty({ type: RefundResponseDto, isArray: true })
  items!: RefundResponseDto[];

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    properties: { createdAt: { type: 'string' }, id: { type: 'string' } },
  })
  nextCursor!: { createdAt: Date; id: string } | undefined;
}
