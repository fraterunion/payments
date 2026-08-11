import { ApiProperty } from '@nestjs/swagger';
import type { ApiEnvironment, ApiKeyStatus } from '@fraterunion-payments/database';

/** Never includes `secretHash` or any form of the secret — only safe, display-oriented metadata. */
export class ApiKeySummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Non-secret identifier, e.g. `a1b2c3d4e5f6`.' }) keyPrefix!: string;
  @ApiProperty() status!: ApiKeyStatus;
  @ApiProperty() environment!: ApiEnvironment;
  @ApiProperty({ type: String, isArray: true }) scopes!: string[];
  @ApiProperty({ nullable: true, type: Date }) lastUsedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) expiresAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) revokedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

/** The only response that ever contains the plaintext key — it is not retrievable again after this. */
export class CreateApiKeyResponseDto {
  @ApiProperty({ description: 'The full API key value. Shown exactly once; store it now.' })
  key!: string;

  @ApiProperty({ type: ApiKeySummaryDto })
  apiKey!: ApiKeySummaryDto;
}
