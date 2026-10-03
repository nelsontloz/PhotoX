import { Injectable } from '@nestjs/common'
import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import { AdminAssetsService } from './admin-assets.service'
import { BullMqService } from '../queue/bullmq.service'
import { SettingsService, type EmbeddingReprocessLastRun } from '../settings/settings.service'

const REPROCESS_PAGE_SIZE = 500
const EMBEDDING_QUEUE = 'process-embeddings'

@Injectable()
export class AdminEmbeddingsService {
  constructor(
    private readonly admin: AdminAssetsService,
    private readonly bullMq: BullMqService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * ponytail: `enqueued` counts requested jobs, not new Redis entries — `enqueue` swallows Redis
   * failures, and an in-flight/completed `embed-<assetId>-<model>` jobId silently dedupes
   * (BullMQ dedupes custom jobIds in any state). `removeOnComplete` drops completed jobs so a
   * later run can re-enqueue the same asset.
   */
  async reprocess(): Promise<{ enqueued: number; total: number; model: string }> {
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
          EMBEDDING_QUEUE,
          'embed',
          { assetId: item.id, fileId: item.fileId, userId: item.userId, reason: 'reprocess' },
          {
            jobId: `embed-${item.id}-${SEARCH_EMBEDDING_MODEL}`,
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
    await this.settings.setEmbeddingReprocessLastRun({
      startedAt,
      total,
      enqueued,
      model: SEARCH_EMBEDDING_MODEL,
    })
    return { enqueued, total, model: SEARCH_EMBEDDING_MODEL }
  }

  async status(): Promise<{
    lastRun: EmbeddingReprocessLastRun | null
    queue: Record<string, number>
  }> {
    const [lastRun, queue] = await Promise.all([
      this.settings.getEmbeddingReprocessLastRun(),
      this.bullMq.getQueue(EMBEDDING_QUEUE).getJobCounts(),
    ])
    return { lastRun, queue }
  }
}
