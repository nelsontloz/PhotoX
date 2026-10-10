import { Controller, Post, Body, HttpCode, HttpStatus, Req, Res } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { clearAccessCookie, setAccessCookie } from '../auth/auth-cookie'
import { AuthService } from './auth.service'
import { TokenService } from './tokens/token.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { RefreshDto } from './dto/logout.dto'

// ponytail: socket peer address — call app.set('trust proxy', ...) in main.ts when behind a
// reverse proxy, otherwise every client shares the proxy's IP for rate limiting
const clientIp = (req: Request): string => req.ip ?? 'unknown'

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  // ponytail: every token-issuing response mirrors the access token into an HttpOnly
  // cookie so same-origin <img>/<video> subresources authenticate without JS
  private setAuthCookie(res: Response, accessToken: string): void {
    setAccessCookie(res, accessToken, this.tokenService.accessCookieMaxAge(accessToken))
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
    )
    this.setAuthCookie(res, result.accessToken)
    return result
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
    const result = await this.authService.login(dto.email, dto.password, clientIp(req))
    this.setAuthCookie(res, result.accessToken)
    return result
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
    const result = await this.authService.refresh(dto.refreshToken, clientIp(req))
    this.setAuthCookie(res, result.accessToken)
    return result
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token (idempotent)' })
  @ApiResponse({ status: 204, description: 'Token revoked' })
  async logout(@Body() dto: RefreshDto, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(dto.refreshToken)
    clearAccessCookie(res)
  }
}
