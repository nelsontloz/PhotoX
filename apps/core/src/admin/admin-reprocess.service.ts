import { Injectable } from '@nestjs/common'
import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import { AdminAssetsService } from './admin-assets.service'
import { BullMqService } from '../queue/bullmq.service'
import {
  SettingsService,
  type DetectionsReprocessLastRun,
  type EmbeddingReprocessLastRun,
  type OcrReprocessLastRun,
} from '../settings/settings.service'

const REPROCESS_PAGE_SIZE = 500

interface ReprocessSpec<L> {
  queue: string
  jobName: string
  jobId: (assetId: string) => string
  getLastRun: () => Promise<L | null>
  setLastRun: (run: { startedAt: string; total: number; enqueued: number }) => Promise<void>
}

@Injectable()
export class AdminReprocessService {
  readonly specs: {
    ocr: ReprocessSpec<OcrReprocessLastRun>
    detections: ReprocessSpec<DetectionsReprocessLastRun>
    embeddings: ReprocessSpec<EmbeddingReprocessLastRun>
  }

  constructor(
    private readonly admin: AdminAssetsService,
    private readonly bullMq: BullMqService,
    settings: SettingsService,
  ) {
    this.specs = {
      ocr: {
        queue: 'process-ocr',
        jobName: 'ocr',
        jobId: (id) => `ocr-reprocess-${id}`,
        getLastRun: () => settings.getOcrReprocessLastRun(),
        setLastRun: (run) => settings.setOcrReprocessLastRun(run),
      },
      detections: {
        queue: 'process-detect',
        jobName: 'detect',
        jobId: (id) => `detect-reprocess-${id}`,
        getLastRun: () => settings.getDetectionsReprocessLastRun(),
        setLastRun: (run) => settings.setDetectionsReprocessLastRun(run),
      },
      embeddings: {
        queue: 'process-embeddings',
        jobName: 'embed',
        jobId: (id) => `embed-reprocess-${id}-${SEARCH_EMBEDDING_MODEL}`,
        getLastRun: () => settings.getEmbeddingReprocessLastRun(),
        setLastRun: (run) =>
          settings.setEmbeddingReprocessLastRun({ ...run, model: SEARCH_EMBEDDING_MODEL }),
      },
    }
  }

  /**
   * ponytail: `enqueued` counts requested jobs, not new Redis entries — `enqueue` swallows Redis
   * failures, and an in-flight/completed `<prefix><assetId>` jobId silently dedupes (BullMQ
   * dedupes custom jobIds in any state). The `-reprocess` suffix follows the F2 lesson: upload-path
   * jobs use bare `ocr-<assetId>` / `detect-<assetId>` / `embed-<assetId>-<model>`, so a first
   * backfill is never skipped as a duplicate. `removeOnComplete` drops completed jobs so a later
   * run can re-enqueue the same asset.
   */
  async reprocess(spec: ReprocessSpec<unknown>): Promise<{ enqueued: number; total: number }> {
    const startedAt = new Date().toISOString()
    const { enqueued, total } = await this.bullMq.enqueuePaged(
      spec.queue,
      spec.jobName,
      (offset) => this.admin.listForReprocess('photo', REPROCESS_PAGE_SIZE, offset),
      (item) => ({
        data: { assetId: item.id, fileId: item.fileId, userId: item.userId, reason: 'reprocess' },
        jobId: spec.jobId(item.id),
      }),
    )
    await spec.setLastRun({ startedAt, total, enqueued })
    return { enqueued, total }
  }

  async status<L>(
    spec: ReprocessSpec<L>,
  ): Promise<{ lastRun: L | null; queue: Record<string, number> }> {
    const [lastRun, queue] = await Promise.all([
      spec.getLastRun(),
      this.bullMq.getQueue(spec.queue).getJobCounts(),
    ])
    return { lastRun, queue }
  }
}
