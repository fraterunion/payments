import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerStatus, CustomerType } from '@fraterunion-payments/database';

export class CustomerResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CustomerType })
  type!: CustomerType;

  @ApiProperty({ enum: CustomerStatus })
  status!: CustomerStatus;

  @ApiPropertyOptional({ nullable: true })
  email!: string | null;

  @ApiPropertyOptional({ nullable: true })
  name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({ nullable: true })
  externalReference!: string | null;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  metadata!: Record<string, unknown>;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  archivedAt!: Date | null;
}

export class CustomerListResponseDto {
  @ApiProperty({ type: CustomerResponseDto, isArray: true })
  items!: CustomerResponseDto[];

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    properties: { createdAt: { type: 'string' }, id: { type: 'string' } },
  })
  nextCursor!: { createdAt: Date; id: string } | undefined;
}

export class ProviderMappingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  provider!: string;

  @ApiPropertyOptional({ nullable: true })
  providerAccountReference!: string | null;

  @ApiProperty()
  providerCustomerId!: string;

  @ApiProperty()
  createdAt!: Date;
}
