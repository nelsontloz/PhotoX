import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import type { AdminAssetCountsResponse, AdminLibraryStatsResponse } from '@photox/shared-types'
import { AdminAssetsService } from './admin-assets.service'

@ApiTags('admin')
@Controller('api/v1/admin/assets')
export class AdminAssetsController {
  constructor(private readonly admin: AdminAssetsService) {}

  @Get('counts')
  @ApiOperation({ summary: 'Asset failure counters grouped by kind (admin-only)' })
  async counts(): Promise<AdminAssetCountsResponse> {
    return this.admin.getFailureCounts()
  }

  @Get('stats')
  @ApiOperation({ summary: 'Library-wide counts, weekly uploads and monthly storage (admin-only)' })
  async stats(): Promise<AdminLibraryStatsResponse> {
    return this.admin.getLibraryStats()
  }
}
