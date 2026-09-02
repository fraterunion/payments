import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProviderAccountConnectionStatus } from '@fraterunion-payments/database';

export class ProviderConnectionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'stripe' })
  provider!: string;

  @ApiProperty({ enum: ProviderAccountConnectionStatus })
  status!: ProviderAccountConnectionStatus;

  @ApiProperty()
  paymentsEnabled!: boolean;

  @ApiProperty()
  payoutsEnabled!: boolean;

  @ApiProperty()
  requirementsDue!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class ProviderConnectionListResponseDto {
  @ApiProperty({ type: ProviderConnectionResponseDto, isArray: true })
  items!: ProviderConnectionResponseDto[];
}

export class ProviderOnboardingLinkResponseDto {
  @ApiProperty({ description: 'Single-use Stripe-hosted onboarding URL. Treat as a credential.' })
  url!: string;

  @ApiPropertyOptional()
  expiresAt?: Date;
}
