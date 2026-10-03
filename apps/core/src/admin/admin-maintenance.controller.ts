import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { IsIn } from 'class-validator'
import type { FaceDetectorKind } from '@photox/shared-types'
import type {
  DetectionsReprocessLastRun,
  EmbeddingReprocessLastRun,
  FaceReprocessLastRun,
  OcrReprocessLastRun,
} from '../settings/settings.service'
import { AdminAssetsService } from './admin-assets.service'
import { AdminFacesService } from './admin-faces.service'
import { AdminEmbeddingsService } from './admin-embeddings.service'
import { AdminOcrService } from './admin-ocr.service'
import { AdminDetectionsService } from './admin-detections.service'
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
    private readonly adminFaces: AdminFacesService,
    private readonly adminEmbeddings: AdminEmbeddingsService,
    private readonly adminOcr: AdminOcrService,
    private readonly adminDetections: AdminDetectionsService,
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

  @Post('faces/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue face re-embed jobs for all non-trashed photos (admin-only)' })
  @ApiResponse({ status: 200, description: 'Re-embed jobs enqueued and the run recorded' })
  async reprocessFaces(): Promise<{
    enqueued: number
    total: number
    detector: FaceDetectorKind
  }> {
    return this.adminFaces.reprocess()
  }

  @Get('faces/reprocess')
  @ApiOperation({ summary: 'Face reprocess last-run record and process-faces queue counts' })
  @ApiResponse({
    status: 200,
    description: 'Last run record (null when never run) and queue counts',
  })
  async faceReprocessStatus(): Promise<{
    lastRun: FaceReprocessLastRun | null
    queue: Record<string, number>
  }> {
    return this.adminFaces.status()
  }

  @Post('faces/recluster')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue a manual face cluster job per distinct user with faces' })
  @ApiResponse({
    status: 200,
    description: 'One cluster job enqueued per distinct user with faces',
  })
  async reclusterFaces(): Promise<{ enqueued: number }> {
    return this.adminFaces.recluster()
  }

  @Post('embeddings/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue embed jobs for all non-trashed photos (admin-only)' })
  @ApiResponse({ status: 200, description: 'Embed jobs enqueued and the run recorded' })
  async reprocessEmbeddings(): Promise<{ enqueued: number; total: number; model: string }> {
    return this.adminEmbeddings.reprocess()
  }

  @Get('embeddings/reprocess')
  @ApiOperation({
    summary: 'Embedding reprocess last-run record and process-embeddings queue counts',
  })
  @ApiResponse({
    status: 200,
    description: 'Last run record (null when never run) and queue counts',
  })
  async embeddingReprocessStatus(): Promise<{
    lastRun: EmbeddingReprocessLastRun | null
    queue: Record<string, number>
  }> {
    return this.adminEmbeddings.status()
  }

  @Post('ocr/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue OCR jobs for all non-trashed photos (admin-only)' })
  @ApiResponse({ status: 200, description: 'OCR jobs enqueued and the run recorded' })
  async reprocessOcr(): Promise<{ enqueued: number; total: number }> {
    return this.adminOcr.reprocess()
  }

  @Get('ocr/reprocess')
  @ApiOperation({ summary: 'OCR reprocess last-run record and process-ocr queue counts' })
  @ApiResponse({
    status: 200,
    description: 'Last run record (null when never run) and queue counts',
  })
  async ocrReprocessStatus(): Promise<{
    lastRun: OcrReprocessLastRun | null
    queue: Record<string, number>
  }> {
    return this.adminOcr.status()
  }

  @Post('detections/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enqueue object-detection jobs for all non-trashed photos (admin-only)',
  })
  @ApiResponse({ status: 200, description: 'Detection jobs enqueued and the run recorded' })
  async reprocessDetections(): Promise<{ enqueued: number; total: number }> {
    return this.adminDetections.reprocess()
  }

  @Get('detections/reprocess')
  @ApiOperation({ summary: 'Detections reprocess last-run record and process-detect queue counts' })
  @ApiResponse({
    status: 200,
    description: 'Last run record (null when never run) and queue counts',
  })
  async detectionsReprocessStatus(): Promise<{
    lastRun: DetectionsReprocessLastRun | null
    queue: Record<string, number>
  }> {
    return this.adminDetections.status()
  }
}
