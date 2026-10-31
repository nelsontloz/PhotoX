import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { loadEnv } from '@photox/shared-config';
import type { RegistrationSettings } from '@photox/shared-types';
import {
  bearerToken,
  clearAccessCookie,
  clearRefreshCookie,
  readAccessCookie,
  readRefreshCookie,
  setAccessCookie,
  setRefreshCookie,
} from '../auth/auth-cookie';
import { AuthService } from './auth.service';
import { TokenService } from './tokens/token.service';
import { SettingsService } from '../settings/settings.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/logout.dto';

// ponytail: socket peer address via req.ip — main.ts sets 'trust proxy', so behind the
// reverse proxy this is the X-Forwarded-For client, not the proxy itself
const clientIp = (req: Request): string => req.ip ?? 'unknown';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly settings: SettingsService,
  ) {}

  // ponytail: every token-issuing response mirrors the access token into an HttpOnly
  // cookie so same-origin <img>/<video> subresources authenticate without JS; the refresh
  // token rides a Path=/api/v1/auth cookie so cookie-only clients can rotate and log out
  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
    req: Request,
  ): void {
    const maxAgeMs = this.tokenService.expiresInSeconds(accessToken) * 1000;
    setAccessCookie(res, accessToken, maxAgeMs, req.secure);
    setRefreshCookie(res, refreshToken, loadEnv().AUTH_REFRESH_TTL, req.secure);
  }

  @Get('registration')
  @ApiOperation({ summary: 'Whether public sign-up is enabled' })
  @ApiResponse({ status: 200, description: 'Current registration setting' })
  async registration(): Promise<RegistrationSettings> {
    return { enabled: await this.settings.isRegistrationEnabled() };
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: 201, description: 'Account created' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(
      dto.email,
      dto.password,
      dto.displayName,
      clientIp(req),
    );
    this.setAuthCookies(res, result.accessToken, result.refreshToken, req);
    return result;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiResponse({ status: 200, description: 'Authenticated' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto.email, dto.password, clientIp(req));
    this.setAuthCookies(res, result.accessToken, result.refreshToken, req);
    return result;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  @ApiResponse({ status: 200, description: 'Tokens rotated' })
  @ApiResponse({ status: 401, description: 'Invalid, revoked, or expired refresh token' })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // body first (explicit credential wins), HttpOnly refresh cookie as the fallback
    const raw = dto.refreshToken ?? readRefreshCookie(req);
    if (!raw) throw new BadRequestException('Refresh token required');
    const result = await this.authService.refresh(raw, clientIp(req));
    this.setAuthCookies(res, result.accessToken, result.refreshToken, req);
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the caller session (idempotent)' })
  @ApiResponse({ status: 204, description: 'Session revoked' })
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = dto.refreshToken ?? readRefreshCookie(req);
    if (raw) await this.authService.logout(raw);
    // A bearer-only client — or an attacker holding nothing but an access token — must still
    // be able to end its own session: the access token identifies the caller, so its session
    // is revoked even when no refresh token is presented. The token is verified with the USER
    // secrets only, so a delegated service token fails closed and revokes nothing (revoking
    // another user's sessions would be a DoS).
    const accessToken = bearerToken(req) ?? readAccessCookie(req);
    const caller = accessToken ? this.tokenService.verifyAccessToken(accessToken) : null;
    // end only the caller's own device session (sid). A token minted before per-device
    // sessions carries none — fall back to the user-wide revoke for it.
    if (caller) {
      if (caller.sid) await this.authService.revokeSession(caller.sid);
      else await this.authService.revokeAllSessions(caller.sub);
    }
    clearAccessCookie(res, req.secure);
    clearRefreshCookie(res, req.secure);
  }
}
