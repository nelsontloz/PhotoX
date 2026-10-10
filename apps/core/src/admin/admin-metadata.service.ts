import { Injectable } from '@nestjs/common'
import { AdminAssetsService } from './admin-assets.service'
import { BullMqService } from '../queue/bullmq.service'
import type { LastRun } from '../settings/settings.service'
import { SettingsService } from '../settings/settings.service'
import { REPROCESS_PAGE_SIZE, reprocessStatus } from './reprocess.util'

const METADATA_QUEUE = 'process-metadata'

@Injectable()
export class AdminMetadataService {
  constructor(
    private readonly admin: AdminAssetsService,
    private readonly bullMq: BullMqService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * ponytail: keyset paging, not offset — completed jobs set phash and shrink the `phash IS NULL`
   * set, so an offset loop would skip rows. `enqueued` counts requested jobs, not new Redis
   * entries (`enqueue` swallows Redis failures, and a custom jobId dedupes in any state). The
   * upload path enqueues process-metadata with no explicit jobId, so the `metadata-reprocess-`
   * prefix can never collide with an in-flight upload; `removeOnComplete` drops completed jobs so
   * a later run can re-enqueue the same asset.
   */
  async reprocess(): Promise<{ enqueued: number; total: number }> {
    const startedAt = new Date().toISOString()
    const total = await this.admin.countPhotosWithoutPhash()
    let afterId: string | null = null
    let enqueued = 0
    for (;;) {
      const page = await this.admin.listPhotosWithoutPhash(REPROCESS_PAGE_SIZE, afterId)
      if (page.items.length === 0) break
      for (const item of page.items) {
        await this.bullMq.enqueue(
          METADATA_QUEUE,
          'process-metadata',
          { assetId: item.id, fileId: item.fileId, userId: item.userId, kind: 'photo' },
          {
            jobId: `metadata-reprocess-${item.id}`,
            removeOnComplete: true,
          },
        )
        enqueued++
      }
      afterId = page.items[page.items.length - 1]!.id
    }
    await this.settings.setLastRun('metadata', { startedAt, total, enqueued })
    return { enqueued, total }
  }

  status(): Promise<{ lastRun: LastRun<'metadata'> | null; queue: Record<string, number> }> {
    return reprocessStatus(this.bullMq, METADATA_QUEUE, () => this.settings.getLastRun('metadata'))
  }
}
