import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { RequestWithId } from '../common/types/request-with-id.type';
import { CurrentOrganizationContext } from './decorators/current-organization-context.decorator';
import { CurrentPrincipal } from './decorators/current-principal.decorator';
import { RequireScopes } from './decorators/require-scopes.decorator';
import {
  AuthContextResponseDto,
  MeResponseDto,
  RefreshResponseDto,
  RegisterResponseDto,
} from './dto/auth-responses.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ActiveSessionGuard } from './guards/active-session.guard';
import { EitherAuthGuard } from './guards/either-auth.guard';
import { HumanJwtAuthGuard } from './guards/human-jwt-auth.guard';
import { OrganizationContextGuard } from './guards/organization-context.guard';
import { RequireScopesGuard } from './guards/require-scopes.guard';
import type { AuthContextResult, AuthResult, RegisterResult } from './services/auth.service';
import { AuthService } from './services/auth.service';
import type {
  AuthenticatedRequest,
  OrganizationScopedRequest,
} from './types/authenticated-request.type';
import type { MeResult } from './types/me.type';
import type { UserPrincipal } from './types/principal.type';
import { extractRequestContext } from './utils/request-context.util';

function toAuthTokensResponse(result: AuthResult): Omit<RegisterResponseDto, 'organization'> {
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    user: {
      id: result.user.id,
      email: result.user.email,
      displayName: result.user.displayName,
      status: result.user.status,
      createdAt: result.user.createdAt,
    },
    session: { id: result.session.id, expiresAt: result.session.expiresAt },
  };
}

function toRegisterResponse(result: RegisterResult): RegisterResponseDto {
  return {
    ...toAuthTokensResponse(result),
    organization: {
      id: result.organization.id,
      name: result.organization.name,
      slug: result.organization.slug,
    },
  };
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOkResponse({ type: RegisterResponseDto })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: RequestWithId,
  ): Promise<RegisterResponseDto> {
    const result = await this.authService.register(dto, extractRequestContext(req));
    return toRegisterResponse(result);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RegisterResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() req: RequestWithId,
  ): Promise<Omit<RegisterResponseDto, 'organization'>> {
    const result = await this.authService.login(dto, extractRequestContext(req));
    return toAuthTokensResponse(result);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RefreshResponseDto })
  async refresh(@Body() dto: RefreshDto, @Req() req: RequestWithId): Promise<RefreshResponseDto> {
    const result = await this.authService.refresh(dto.refreshToken, extractRequestContext(req));
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      session: { id: result.session.id, expiresAt: result.session.expiresAt },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('bearer')
  @UseGuards(HumanJwtAuthGuard, ActiveSessionGuard)
  async logout(
    @CurrentPrincipal() principal: UserPrincipal,
    @Req() req: RequestWithId,
  ): Promise<void> {
    await this.authService.logout(principal, extractRequestContext(req));
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('bearer')
  @UseGuards(HumanJwtAuthGuard, ActiveSessionGuard)
  async logoutAll(
    @CurrentPrincipal() principal: UserPrincipal,
    @Req() req: RequestWithId,
  ): Promise<void> {
    await this.authService.logoutAll(principal, extractRequestContext(req));
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOkResponse({ type: MeResponseDto })
  @UseGuards(HumanJwtAuthGuard, ActiveSessionGuard)
  async me(@CurrentPrincipal() principal: UserPrincipal): Promise<MeResult> {
    return this.authService.me(principal);
  }

  /**
   * Diagnostic only: confirms which principal is authenticated and how it
   * resolved organization context. Not a business endpoint — see
   * docs/architecture/authentication-and-access-control.md.
   */
  @Get('context')
  @ApiBearerAuth('bearer')
  @ApiSecurity('apiKey')
  @ApiOkResponse({ type: AuthContextResponseDto })
  @RequireScopes('organizations:read')
  @UseGuards(EitherAuthGuard, ActiveSessionGuard, OrganizationContextGuard, RequireScopesGuard)
  context(
    @CurrentPrincipal() principal: AuthenticatedRequest['principal'],
    @CurrentOrganizationContext()
    organizationContext: OrganizationScopedRequest['organizationContext'],
  ): AuthContextResult {
    return this.authService.context(principal, organizationContext);
  }
}
