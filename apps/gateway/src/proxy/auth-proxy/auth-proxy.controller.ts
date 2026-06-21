import { Controller, Post, Body, Req, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { Public } from '../../auth/public.decorator'
import { ProxyService } from '../proxy.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { RefreshDto } from './dto/refresh.dto'
import { LogoutDto } from './dto/logout.dto'
import { SERVICE_URLS } from '@photox/shared-config'

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: 201, description: 'Account created' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.proxy.forward(SERVICE_URLS['user-service'], {
      method: 'POST',
      path: 'v1/auth/register',
      body: dto,
      headers: { 'x-request-id': (req.headers['x-request-id'] as string) ?? '' },
      timeout: 30_000,
    })
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiResponse({ status: 200, description: 'Authenticated' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.proxy.forward(SERVICE_URLS['user-service'], {
      method: 'POST',
      path: 'v1/auth/login',
      body: dto,
      headers: { 'x-request-id': (req.headers['x-request-id'] as string) ?? '' },
      timeout: 30_000,
    })
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  @ApiResponse({ status: 200, description: 'Tokens rotated' })
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.proxy.forward(SERVICE_URLS['user-service'], {
      method: 'POST',
      path: 'v1/auth/refresh',
      body: dto,
      headers: { 'x-request-id': (req.headers['x-request-id'] as string) ?? '' },
      timeout: 30_000,
    })
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token (idempotent)' })
  @ApiResponse({ status: 204, description: 'Token revoked' })
  async logout(@Body() dto: LogoutDto, @Req() req: Request) {
    await this.proxy.forward(SERVICE_URLS['user-service'], {
      method: 'POST',
      path: 'v1/auth/logout',
      body: dto,
      headers: { 'x-request-id': (req.headers['x-request-id'] as string) ?? '' },
      timeout: 30_000,
    })
  }
}
