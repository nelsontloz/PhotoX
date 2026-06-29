import { Controller, Post, Body, Req, UseGuards, Logger } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { SERVICE_URLS } from '@photox/shared-config'
import type {
  AdminAssetReprocessListResponse,
  AdminReprocessThumbnailsResponse,
} from '@photox/shared-types'
import { ProxyService } from '../proxy.service'
import { ThumbnailOrchestratorService } from '../../orchestrator/thumbnail-orchestrator.service'
import { AdminGuard } from '../../auth/admin.guard'
import { ReprocessThumbnailsDto } from './dto/reprocess-thumbnails.dto'

const PAGE_SIZE = 200

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('api/v1/admin/thumbnails')
export class AdminThumbnailsProxyController {
  private readonly logger = new Logger(AdminThumbnailsProxyController.name)

  constructor(
    private readonly proxy: ProxyService,
    private readonly thumbnails: ThumbnailOrchestratorService,
  ) {}

  @Post('reprocess')
  @ApiOperation({
    summary: 'Enqueue thumbnail regeneration jobs for every asset of a kind (admin only)',
  })
  @ApiResponse({ status: 200, description: 'Number of assets enqueued and total' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async reprocess(
    @Body() dto: ReprocessThumbnailsDto,
    @Req() req: Request,
  ): Promise<AdminReprocessThumbnailsResponse> {
    const requestId = (req.headers['x-request-id'] as string) ?? ''
    let totalAssets = 0
    let enqueued = 0
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const page = await this.proxy.forward<AdminAssetReprocessListResponse>(
        SERVICE_URLS['media-service'],
        {
          method: 'GET',
          path: 'v1/admin/assets',
          query: { kind: dto.kind, limit: String(PAGE_SIZE), offset: String(offset) },
          headers: { 'x-request-id': requestId },
          timeout: 10_000,
        },
      )

      const items = page.data.items
      if (items.length === 0) {
        hasMore = false
        break
      }

      if (offset === 0) totalAssets = page.data.total

      for (const a of items) {
        await this.thumbnails.enqueueThumbnails(a.id, a.fileId, a.userId, { force: true })
        enqueued += 1
      }

      if (items.length < PAGE_SIZE) {
        hasMore = false
      } else {
        offset += PAGE_SIZE
      }
    }

    this.logger.log({
      msg: 'thumbnail reprocess kicked off',
      kind: dto.kind,
      enqueued,
      totalAssets,
      requestId,
    })

    return { enqueued, totalAssets }
  }
}
