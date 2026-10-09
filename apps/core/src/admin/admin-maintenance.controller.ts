import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { IsIn } from 'class-validator'
import { SEARCH_EMBEDDING_MODEL, type FaceDetectorKind } from '@photox/shared-types'
import type {
  DetectionsReprocessLastRun,
  EmbeddingReprocessLastRun,
  FaceReprocessLastRun,
  MetadataReprocessLastRun,
  OcrReprocessLastRun,
  PlacesBackfillLastRun,
} from '../settings/settings.service'
import { AdminAssetsService } from './admin-assets.service'
import { AdminFacesService } from './admin-faces.service'
import { AdminReprocessService } from './admin-reprocess.service'
import { AdminPlacesService } from './admin-places.service'
import { AdminMetadataService } from './admin-metadata.service'
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
    private readonly adminReprocess: AdminReprocessService,
    private readonly adminPlaces: AdminPlacesService,
    private readonly adminMetadata: AdminMetadataService,
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
    let enqueued = 0
    let totalAssets = 0
    for (const size of ['sm', 'md', 'lg', 'xl'] as const) {
      const page = await this.bullMq.enqueuePaged(
        'process-thumbnail',
        'process-thumbnail',
        (offset) => this.admin.listForReprocess(dto.kind, 500, offset),
        (item) => ({
          data: { assetId: item.id, fileId: item.fileId, userId: item.userId, size },
          jobId: `thumb-reprocess-${item.id}-${size}`,
        }),
      )
      enqueued += page.enqueued
      totalAssets = page.total
    }
    return { enqueued, totalAssets }
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
    const { enqueued, total } = await this.adminReprocess.reprocess(
      this.adminReprocess.specs.embeddings,
    )
    return { enqueued, total, model: SEARCH_EMBEDDING_MODEL }
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
    return this.adminReprocess.status(this.adminReprocess.specs.embeddings)
  }

  @Post('ocr/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue OCR jobs for all non-trashed photos (admin-only)' })
  @ApiResponse({ status: 200, description: 'OCR jobs enqueued and the run recorded' })
  async reprocessOcr(): Promise<{ enqueued: number; total: number }> {
    return this.adminReprocess.reprocess(this.adminReprocess.specs.ocr)
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
    return this.adminReprocess.status(this.adminReprocess.specs.ocr)
  }

  @Post('detections/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enqueue object-detection jobs for all non-trashed photos (admin-only)',
  })
  @ApiResponse({ status: 200, description: 'Detection jobs enqueued and the run recorded' })
  async reprocessDetections(): Promise<{ enqueued: number; total: number }> {
    return this.adminReprocess.reprocess(this.adminReprocess.specs.detections)
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
    return this.adminReprocess.status(this.adminReprocess.specs.detections)
  }

  @Post('places/backfill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve place fields for all assets with coordinates and no city (admin-only)',
  })
  @ApiResponse({ status: 200, description: 'Place resolution counts and the run recorded' })
  async backfillPlaces(): Promise<{ updated: number; total: number }> {
    return this.adminPlaces.backfill()
  }

  @Get('places/backfill')
  @ApiOperation({ summary: 'Places backfill last-run record' })
  @ApiResponse({ status: 200, description: 'Last run record (null when never run)' })
  async placesBackfillStatus(): Promise<{ lastRun: PlacesBackfillLastRun | null }> {
    return this.adminPlaces.status()
  }

  @Post('metadata/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enqueue metadata jobs for non-trashed photos missing a phash (admin-only)',
  })
  @ApiResponse({ status: 200, description: 'Metadata jobs enqueued and the run recorded' })
  async reprocessMetadata(): Promise<{ enqueued: number; total: number }> {
    return this.adminMetadata.reprocess()
  }

  @Get('metadata/reprocess')
  @ApiOperation({
    summary: 'Metadata reprocess last-run record and process-metadata queue counts',
  })
  @ApiResponse({
    status: 200,
    description: 'Last run record (null when never run) and queue counts',
  })
  async metadataReprocessStatus(): Promise<{
    lastRun: MetadataReprocessLastRun | null
    queue: Record<string, number>
  }> {
    return this.adminMetadata.status()
  }
}
