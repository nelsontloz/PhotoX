import {
  Controller, Get, Patch, Body, Req, HttpException,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { CurrentUser, type CurrentUser as CurrentUserType } from '../../auth/current-user.decorator'
import { ProxyService } from '../proxy.service'
import { SERVICE_URLS } from '@photox/shared-config'

@ApiTags('users')
@Controller('api/v1/users/me')
export class UsersProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 501, description: 'Not Implemented' })
  async getProfile(@CurrentUser() user: CurrentUserType, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['user-service'], {
      method: 'GET',
      path: 'v1/users/me',
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        'x-user-id': user.id,
        'x-user-email': user.email,
      },
    })

    if (result.status === 404) {
      throw new HttpException({ statusCode: 501, message: 'Not Implemented' }, 501)
    }

    return result.data
  }

  @Patch()
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 501, description: 'Not Implemented' })
  async updateProfile(@CurrentUser() user: CurrentUserType, @Body() body: unknown, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['user-service'], {
      method: 'PATCH',
      path: 'v1/users/me',
      body,
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        'x-user-id': user.id,
        'x-user-email': user.email,
      },
    })

    if (result.status === 404) {
      throw new HttpException({ statusCode: 501, message: 'Not Implemented' }, 501)
    }

    return result.data
  }
}
