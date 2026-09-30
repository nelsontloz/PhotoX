import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { IsIn } from 'class-validator'
import { AdminAssetsService } from './admin-assets.service'
import { BullMqService } from '../queue/bullmq.service'

class ReprocessThumbnailsDto {
  @IsIn(['photo', 'video'])
  kind!: 'photo' | 'video'
}

@ApiTags('admin')
@Controller('api/v1/admin')
export class AdminMaintenanceController {
  constructor(
    private readonly admin: AdminAssetsService,
    private readonly bullMq: BullMqService,
  ) {}

  @Get('orphan-counts')
  @ApiOperation({ summary: 'Count orphan files and thumbnail rows (admin-only)' })
  async orphanCounts(): Promise<{ orphanFiles: number; orphanThumbnails: number }> {
    return this.admin.getOrphanCounts()
  }

  @Post('cleanup-orphans')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue orphan cleanup job (admin-only)' })
  @ApiResponse({ status: 200, description: 'Cleanup job enqueued' })
  async cleanupOrphans(): Promise<{ enqueued: boolean }> {
    await this.bullMq.enqueue('cleanup-orphans', 'cleanup-orphans', {})
    return { enqueued: true }
  }

  @Post('cleanup-orphans/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run orphan cleanup inline (admin-only)' })
  @ApiResponse({ status: 200, description: 'Deleted orphan file, thumbnail and stray counts' })
  async runCleanupOrphans(): Promise<{
    deletedFiles: number
    deletedThumbnails: number
    deletedStrays: number
  }> {
    return this.admin.cleanupOrphans()
  }

  @Post('thumbnails/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue thumbnail reprocess jobs for all assets of a kind' })
  async reprocess(
    @Body() dto: ReprocessThumbnailsDto,
  ): Promise<{ enqueued: number; totalAssets: number }> {
    const limit = 500
    let offset = 0
    let enqueued = 0
    let total = 0
    for (;;) {
      const page = await this.admin.listForReprocess(dto.kind, limit, offset)
      total = page.total
      if (page.items.length === 0) break
      for (const item of page.items) {
        this.bullMq.enqueueThumbnails(item.id, item.fileId, item.userId, 'thumb-reprocess')
      }
      enqueued += page.items.length * 4
      offset += page.items.length
      if (offset >= total) break
    }
    return { enqueued, totalAssets: total }
  }
}
