import { Injectable } from '@nestjs/common'
import { AdminAssetsService } from './admin-assets.service'
import { BullMqService } from '../queue/bullmq.service'
import { SettingsService, type DetectionsReprocessLastRun } from '../settings/settings.service'

const REPROCESS_PAGE_SIZE = 500
const DETECTIONS_QUEUE = 'process-detect'

@Injectable()
export class AdminDetectionsService {
  constructor(
    private readonly admin: AdminAssetsService,
    private readonly bullMq: BullMqService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * ponytail: `enqueued` counts requested jobs, not new Redis entries — `enqueue` swallows Redis
   * failures, and an in-flight/completed `detect-reprocess-<assetId>` jobId silently dedupes
   * (BullMQ dedupes custom jobIds in any state). The `-reprocess` suffix follows the F2 lesson:
   * upload-path jobs use a bare `detect-<assetId>`, so a first backfill is never skipped as a
   * duplicate. `removeOnComplete` drops completed jobs so a later run can re-enqueue the asset.
   */
  async reprocess(): Promise<{ enqueued: number; total: number }> {
    const startedAt = new Date().toISOString()
    let offset = 0
    let enqueued = 0
    let total = 0
    for (;;) {
      const page = await this.admin.listForReprocess('photo', REPROCESS_PAGE_SIZE, offset)
      total = page.total
      if (page.items.length === 0) break
      for (const item of page.items) {
        await this.bullMq.enqueue(
          DETECTIONS_QUEUE,
          'detect',
          { assetId: item.id, fileId: item.fileId, userId: item.userId, reason: 'reprocess' },
          {
            jobId: `detect-reprocess-${item.id}`,
            attempts: 3,
            backoff: { type: 'exponential' },
            removeOnFail: true,
            removeOnComplete: true,
          },
        )
        enqueued++
      }
      offset += page.items.length
      if (offset >= total) break
    }
    await this.settings.setDetectionsReprocessLastRun({ startedAt, total, enqueued })
    return { enqueued, total }
  }

  async status(): Promise<{
    lastRun: DetectionsReprocessLastRun | null
    queue: Record<string, number>
  }> {
    const [lastRun, queue] = await Promise.all([
      this.settings.getDetectionsReprocessLastRun(),
      this.bullMq.getQueue(DETECTIONS_QUEUE).getJobCounts(),
    ])
    return { lastRun, queue }
  }
}
