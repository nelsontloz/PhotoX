import { Injectable } from '@nestjs/common'
import { AdminAssetsService } from './admin-assets.service'
import { BullMqService } from '../queue/bullmq.service'
import { SettingsService, type OcrReprocessLastRun } from '../settings/settings.service'

const REPROCESS_PAGE_SIZE = 500
const OCR_QUEUE = 'process-ocr'

@Injectable()
export class AdminOcrService {
  constructor(
    private readonly admin: AdminAssetsService,
    private readonly bullMq: BullMqService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * ponytail: `enqueued` counts requested jobs, not new Redis entries — `enqueue` swallows Redis
   * failures, and an in-flight/completed `ocr-reprocess-<assetId>` jobId silently dedupes (BullMQ
   * dedupes custom jobIds in any state). The `-reprocess` suffix follows the F2 lesson: upload-path
   * jobs use a bare `ocr-<assetId>`, so a first backfill is never skipped as a duplicate.
   * `removeOnComplete` drops completed jobs so a later run can re-enqueue the same asset.
   */
  async reprocess(): Promise<{ enqueued: number; total: number }> {
    const startedAt = new Date().toISOString()
    const { enqueued, total } = await this.bullMq.enqueuePaged(
      OCR_QUEUE,
      'ocr',
      (offset) => this.admin.listForReprocess('photo', REPROCESS_PAGE_SIZE, offset),
      (item) => ({
        data: { assetId: item.id, fileId: item.fileId, userId: item.userId, reason: 'reprocess' },
        jobId: `ocr-reprocess-${item.id}`,
      }),
    )
    await this.settings.setOcrReprocessLastRun({ startedAt, total, enqueued })
    return { enqueued, total }
  }

  async status(): Promise<{ lastRun: OcrReprocessLastRun | null; queue: Record<string, number> }> {
    const [lastRun, queue] = await Promise.all([
      this.settings.getOcrReprocessLastRun(),
      this.bullMq.getQueue(OCR_QUEUE).getJobCounts(),
    ])
    return { lastRun, queue }
  }
}
