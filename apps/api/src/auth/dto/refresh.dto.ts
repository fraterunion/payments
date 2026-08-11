import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const REFRESH_TOKEN_MAX_LENGTH = 512;

export class RefreshDto {
  @ApiProperty({ writeOnly: true })
  @IsString()
  @IsNotEmpty()
  @MaxLength(REFRESH_TOKEN_MAX_LENGTH)
  refreshToken!: string;
}
