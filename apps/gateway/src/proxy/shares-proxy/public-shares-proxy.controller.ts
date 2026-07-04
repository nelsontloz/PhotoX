import { Controller, Get, Param, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { ProxyService } from '../proxy.service'
import { SERVICE_URLS } from '@photox/shared-config'
import { Public } from '../../auth/public.decorator'

@ApiTags('shares')
@Controller('api/share')
export class PublicSharesProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'View a shared asset by public token' })
  @ApiResponse({ status: 200, description: 'Shared asset info' })
  @ApiResponse({ status: 404, description: 'Share not found' })
  async getByToken(@Param('token') token: string, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: `v1/shares/public/${token}`,
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }
}
