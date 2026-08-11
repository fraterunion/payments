import { ApiProperty } from '@nestjs/swagger';
import type { MembershipRole, UserStatus } from '@fraterunion-payments/database';

export class UserSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) displayName!: string | null;
  @ApiProperty() status!: UserStatus;
  @ApiProperty() createdAt!: Date;
}

export class SessionSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() expiresAt!: Date;
}

/** Never includes the organization or membership — those require a separate `x-organization-id`-scoped request once the caller has tokens. */
export class AuthTokensResponseDto {
  @ApiProperty({ description: 'Short-lived JWT. Send as `Authorization: Bearer <accessToken>`.' })
  accessToken!: string;

  @ApiProperty({
    description: 'Opaque refresh token, shown only in this response. Rotates on every use.',
  })
  refreshToken!: string;

  @ApiProperty({ type: UserSummaryDto })
  user!: UserSummaryDto;

  @ApiProperty({ type: SessionSummaryDto })
  session!: SessionSummaryDto;
}

export class OrganizationSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

export class RegisterResponseDto extends AuthTokensResponseDto {
  @ApiProperty({ type: OrganizationSummaryDto })
  organization!: OrganizationSummaryDto;
}

export class RefreshResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ type: SessionSummaryDto }) session!: SessionSummaryDto;
}

export class MembershipSummaryDto {
  @ApiProperty() organizationId!: string;
  @ApiProperty() organizationName!: string;
  @ApiProperty() organizationSlug!: string;
  @ApiProperty() role!: MembershipRole;
}

export class MeResponseDto {
  @ApiProperty({ type: UserSummaryDto }) user!: UserSummaryDto;
  @ApiProperty({ type: MembershipSummaryDto, isArray: true }) memberships!: MembershipSummaryDto[];
  @ApiProperty({ type: SessionSummaryDto }) session!: SessionSummaryDto;
}

export class AuthContextResponseDto {
  @ApiProperty({ enum: ['USER', 'API_KEY'] }) principalType!: 'USER' | 'API_KEY';
  @ApiProperty() organizationId!: string;
  @ApiProperty({ required: false }) role?: MembershipRole;
  @ApiProperty({ required: false }) environment?: string;
  @ApiProperty({ required: false, type: String, isArray: true }) scopes?: string[];
}
