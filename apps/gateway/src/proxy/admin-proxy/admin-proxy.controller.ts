import { Controller, Get, Post, HttpCode, HttpStatus, UseGuards } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { firstValueFrom } from 'rxjs'
import { SERVICE_URLS } from '@photox/shared-config'
import { BullMqService } from '../../queue/bullmq.service'
import { AdminGuard } from '../../auth/admin.guard'

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('api/v1/admin')
export class AdminProxyController {
  constructor(
    private readonly bullmq: BullMqService,
    private readonly http: HttpService,
  ) {}

  @Get('orphan-counts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Count orphan files and thumbnail rows' })
  @ApiResponse({ status: 200, description: 'Orphan counts' })
  async orphanCounts() {
    try {
      const mediaRes = await firstValueFrom(
        this.http.get<string[]>(`${SERVICE_URLS['media-service']}/v1/internal/file-ids`, {
          timeout: 30_000,
        }),
      )
      const mediaFileIds = new Set(mediaRes.data)

      const storageRes = await firstValueFrom(
        this.http.get<string[]>(`${SERVICE_URLS['file-storage-service']}/v1/internal/file-ids`, {
          timeout: 30_000,
        }),
      )
      const storageFileIds = storageRes.data

      const orphanFileIds = storageFileIds.filter((id) => !mediaFileIds.has(id))

      let orphanThumbnails = 0
      if (storageFileIds.length > 0) {
        const thumbRes = await firstValueFrom(
          this.http.post<{ assetId: string; size: string; fileId: string }[]>(
            `${SERVICE_URLS['media-service']}/v1/internal/thumbnails/orphan-rows`,
            { existingFileIds: storageFileIds },
            { timeout: 30_000 },
          ),
        )
        orphanThumbnails = thumbRes.data.length
      }

      return { orphanFiles: orphanFileIds.length, orphanThumbnails }
    } catch {
      return { orphanFiles: 0, orphanThumbnails: 0 }
    }
  }

  @Post('cleanup-orphans')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue an orphan file/thumbnail cleanup job' })
  @ApiResponse({ status: 202, description: 'Job enqueued' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  cleanupOrphans() {
    void this.bullmq.enqueue(
      'cleanup-orphans',
      'cleanup-orphans',
      {},
      { jobId: `orphan-cleanup-${Date.now()}` },
    )
    return { enqueued: true }
  }
}
