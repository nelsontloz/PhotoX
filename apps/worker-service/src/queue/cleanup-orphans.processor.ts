import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { BullMqService } from './bullmq.service'
import { SERVICE_URLS } from '@photox/shared-config'

@Injectable()
export class CleanupOrphansProcessor {
  private readonly logger = new Logger(CleanupOrphansProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly http: HttpService,
  ) {}

  start() {
    this.bullMq.createWorker('cleanup-orphans', () => this.processJob(), {
      concurrency: 1,
    })
    this.logger.log('Cleanup orphans processor listening for jobs')
  }

  private async processJob() {
    this.logger.log('Orphan cleanup starting')

    const mediaRes = await firstValueFrom(
      this.http.get<string[]>(`${SERVICE_URLS['media-service']}/v1/file-ids`, {
        timeout: 30_000,
      }),
    )
    const mediaFileIds = new Set(mediaRes.data)

    const storageRes = await firstValueFrom(
      this.http.get<string[]>(`${SERVICE_URLS['file-storage-service']}/v1/file-ids`, {
        timeout: 30_000,
      }),
    )
    const storageFileIds = storageRes.data

    const orphanFileIds = storageFileIds.filter((id) => !mediaFileIds.has(id))
    this.logger.log(`Found ${orphanFileIds.length} orphan files`)

    let orphanThumbRows: { assetId: string; size: string; fileId: string }[] = []
    if (storageFileIds.length > 0) {
      const thumbRes = await firstValueFrom(
        this.http.post<{ assetId: string; size: string; fileId: string }[]>(
          `${SERVICE_URLS['media-service']}/v1/thumbnails/orphan-rows`,
          { existingFileIds: storageFileIds },
          { timeout: 30_000 },
        ),
      )
      orphanThumbRows = thumbRes.data
    }
    this.logger.log(`Found ${orphanThumbRows.length} orphan thumbnail rows`)

    let deleted = 0
    for (const fileId of orphanFileIds) {
      try {
        await firstValueFrom(
          this.http.delete(`${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}`, {
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

    for (const { assetId, size } of orphanThumbRows) {
      try {
        await firstValueFrom(
          this.http.delete(`${SERVICE_URLS['media-service']}/v1/thumbnails/${assetId}/${size}`, {
            timeout: 30_000,
          }),
        )
      } catch (err) {
        this.logger.warn(
          `Failed to delete orphan thumbnail ${assetId}/${size}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    this.logger.log(
      `Orphan cleanup complete: deleted ${deleted} files, ${orphanThumbRows.length} thumbnail rows`,
    )
  }
}
