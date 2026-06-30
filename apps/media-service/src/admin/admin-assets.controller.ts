import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import type {
  AdminAssetCountsResponse,
  AdminAssetReprocessListResponse,
} from '@photox/shared-types'
import { AdminAssetsService } from './admin-assets.service'
import { ListAdminAssetsQueryDto } from './dto/list-admin-assets.query.dto'

@ApiTags('admin')
@Controller('v1/admin/assets')
export class AdminAssetsController {
  constructor(private readonly admin: AdminAssetsService) {}

  @Get('counts')
  @ApiOperation({ summary: 'Asset failure counters grouped by kind (admin-only)' })
  async counts(): Promise<AdminAssetCountsResponse> {
    return this.admin.getFailureCounts()
  }

  @Get()
  @ApiOperation({
    summary: 'List assets across all users for reprocessing (admin-only)',
  })
  async list(@Query() q: ListAdminAssetsQueryDto): Promise<AdminAssetReprocessListResponse> {
    return this.admin.listForReprocess(q.kind, q.limit ?? 200, q.offset ?? 0)
  }
}
