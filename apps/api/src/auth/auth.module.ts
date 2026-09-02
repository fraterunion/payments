import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { ApiKeysController } from './api-keys.controller';
import { AuthController } from './auth.controller';
import { ActiveSessionGuard } from './guards/active-session.guard';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { EitherAuthGuard } from './guards/either-auth.guard';
import { HumanJwtAuthGuard } from './guards/human-jwt-auth.guard';
import { OrganizationContextGuard } from './guards/organization-context.guard';
import { RequireRolesGuard } from './guards/require-roles.guard';
import { RequireScopesGuard } from './guards/require-scopes.guard';
import { AccessTokenService } from './services/access-token.service';
import { ApiKeyService } from './services/api-key.service';
import { AuthService } from './services/auth.service';
import { OrganizationMembershipService } from './services/organization-membership.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [AuthController, ApiKeysController],
  providers: [
    PasswordService,
    AccessTokenService,
    SessionService,
    ApiKeyService,
    OrganizationMembershipService,
    AuthService,
    HumanJwtAuthGuard,
    ActiveSessionGuard,
    ApiKeyAuthGuard,
    EitherAuthGuard,
    OrganizationContextGuard,
    RequireRolesGuard,
    RequireScopesGuard,
  ],
  exports: [
    AccessTokenService,
    SessionService,
    ApiKeyService,
    HumanJwtAuthGuard,
    ApiKeyAuthGuard,
    EitherAuthGuard,
    ActiveSessionGuard,
    OrganizationContextGuard,
    RequireRolesGuard,
    RequireScopesGuard,
  ],
})
export class AuthModule {}
