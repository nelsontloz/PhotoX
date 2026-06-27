import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { SERVICE_URLS } from '@photox/shared-config'
import type { AdminAssetCountsResponse } from '@photox/shared-types'
import { ProxyService } from '../proxy.service'
import { AdminGuard } from '../../auth/admin.guard'

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('api/v1/admin/assets')
export class AdminAssetsProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Get('counts')
  @ApiOperation({ summary: 'Asset failure counters (admin only)' })
  @ApiResponse({ status: 200, description: 'Failure counts per kind' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async counts(@Req() req: Request): Promise<AdminAssetCountsResponse> {
    const result = await this.proxy.forward<AdminAssetCountsResponse>(
      SERVICE_URLS['media-service'],
      {
        method: 'GET',
        path: 'v1/admin/assets/counts',
        headers: {
          'x-request-id': (req.headers['x-request-id'] as string) ?? '',
        },
        timeout: 5_000,
      },
    )
    return result.data
  }
}
