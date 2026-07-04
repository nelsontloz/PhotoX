import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import type { Job } from 'bullmq'
import { BullMqService } from './bullmq.service'
import { SERVICE_URLS } from '@photox/shared-config'

interface OrphanCleanupJob {
  dryRun?: boolean
}

@Injectable()
export class CleanupOrphansProcessor {
  private readonly logger = new Logger(CleanupOrphansProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly http: HttpService,
  ) {}

  start() {
    this.bullMq.createWorker<OrphanCleanupJob>(
      'cleanup-orphans',
      (job) => this.processJob(job),
      { concurrency: 1 },
    )
    this.logger.log('Cleanup orphans processor listening for jobs')
  }

  private async processJob(job: Job<OrphanCleanupJob>) {
    const dryRun = job.data.dryRun ?? false
    this.logger.log(`Orphan cleanup starting (dryRun=${dryRun})`)

    // 1. Get fileIds referenced by media-service
    const mediaRes = await firstValueFrom(
      this.http.get<string[]>(`${SERVICE_URLS['media-service']}/v1/internal/file-ids`, {
        timeout: 30_000,
      }),
    )
    const mediaFileIds = new Set(mediaRes.data)

    // 2. Get all FileRecord IDs from file-storage-service
    const storageRes = await firstValueFrom(
      this.http.get<string[]>(`${SERVICE_URLS['file-storage-service']}/v1/internal/file-ids`, {
        timeout: 30_000,
      }),
    )
    const storageFileIds = storageRes.data

    // 3. Find orphan files (in storage but not referenced by media)
    const orphanFileIds = storageFileIds.filter((id) => !mediaFileIds.has(id))
    this.logger.log(`Found ${orphanFileIds.length} orphan files`)

    // 4. Find orphan thumbnail rows (media rows pointing to missing storage files)
    let orphanThumbRows: { assetId: string; size: string; fileId: string }[] = []
    if (storageFileIds.length > 0) {
      const thumbRes = await firstValueFrom(
        this.http.get<{ assetId: string; size: string; fileId: string }[]>(
          `${SERVICE_URLS['media-service']}/v1/internal/thumbnails/orphan-rows`,
          {
            params: { existingFileIds: storageFileIds.join(',') },
            timeout: 30_000,
          },
        ),
      )
      orphanThumbRows = thumbRes.data
    }
    this.logger.log(`Found ${orphanThumbRows.length} orphan thumbnail rows`)

    if (dryRun) {
      this.logger.log(
        `Dry run — would delete ${orphanFileIds.length} files and ${orphanThumbRows.length} thumbnail rows`,
      )
      return
    }

    // 5. Delete orphan files
    let deleted = 0
    for (const fileId of orphanFileIds) {
      try {
        await firstValueFrom(
          this.http.delete(`${SERVICE_URLS['file-storage-service']}/v1/internal/files/${fileId}`, {
            timeout: 30_000,
          }),
        )
        deleted++
      } catch (err) {
        this.logger.warn(
          `Failed to delete orphan file ${fileId}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // 6. Delete orphan thumbnail rows
    for (const { assetId, size } of orphanThumbRows) {
      try {
        await firstValueFrom(
          this.http.delete(
            `${SERVICE_URLS['media-service']}/v1/internal/thumbnails/${assetId}/${size}`,
            { timeout: 30_000 },
          ),
        )
      } catch (err) {
        this.logger.warn(
          `Failed to delete orphan thumbnail ${assetId}/${size}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    this.logger.log(`Orphan cleanup complete: deleted ${deleted} files, ${orphanThumbRows.length} thumbnail rows`)
  }
}
