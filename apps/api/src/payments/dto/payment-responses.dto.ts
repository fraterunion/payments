import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PaymentCaptureMethod,
  PaymentFailureCategory,
  PaymentStatus,
} from '@fraterunion-payments/database';

export class PaymentFailureResponseDto {
  @ApiProperty({ enum: PaymentFailureCategory })
  category!: PaymentFailureCategory;

  @ApiPropertyOptional()
  code?: string;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  retryable!: boolean;
}

export class PaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  customerId!: string | null;

  @ApiProperty({ enum: PaymentStatus })
  status!: PaymentStatus;

  @ApiProperty({ enum: PaymentCaptureMethod })
  captureMethod!: PaymentCaptureMethod;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: 'Integer minor units as a decimal string.' })
  requestedAmount!: string;

  @ApiProperty({ description: 'Integer minor units as a decimal string.' })
  authorizedAmount!: string;

  @ApiProperty({ description: 'Integer minor units as a decimal string.' })
  capturedAmount!: string;

  @ApiProperty({ description: 'Integer minor units as a decimal string.' })
  refundedAmount!: string;

  @ApiPropertyOptional({ type: PaymentFailureResponseDto, nullable: true })
  failure!: PaymentFailureResponseDto | null;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  metadata!: Record<string, unknown>;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class PaymentListResponseDto {
  @ApiProperty({ type: PaymentResponseDto, isArray: true })
  items!: PaymentResponseDto[];

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    properties: { createdAt: { type: 'string' }, id: { type: 'string' } },
  })
  nextCursor!: { createdAt: Date; id: string } | undefined;
}
