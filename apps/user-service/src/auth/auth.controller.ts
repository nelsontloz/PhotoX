import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { RefreshDto } from './dto/refresh.dto'
import { LogoutDto } from './dto/logout.dto'
import { AuthResponseDto } from './dto/auth-response.dto'

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: 201, description: 'Account created', type: AuthResponseDto })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password, dto.displayName)
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiResponse({ status: 200, description: 'Authenticated', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password)
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  @ApiResponse({ status: 200, description: 'Tokens rotated', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid, revoked, or expired refresh token' })
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken)
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token (idempotent)' })
  @ApiResponse({ status: 204, description: 'Token revoked' })
  async logout(@Body() dto: LogoutDto) {
    await this.authService.logout(dto.refreshToken)
  }
}
