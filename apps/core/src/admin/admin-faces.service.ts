import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { FaceDetectorKind } from '@photox/shared-types'
import { AdminAssetsService } from './admin-assets.service'
import { BullMqService } from '../queue/bullmq.service'
import { SettingsService, type FaceReprocessLastRun } from '../settings/settings.service'

const REPROCESS_PAGE_SIZE = 500

@Injectable()
export class AdminFacesService {
  constructor(
    private readonly admin: AdminAssetsService,
    private readonly bullMq: BullMqService,
    private readonly settings: SettingsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * ponytail: `enqueued` counts requested jobs, not new Redis entries — `enqueue` swallows Redis
   * failures, and an in-flight/completed `face-reembed-<assetId>` jobId silently dedupes (BullMQ
   * dedupes custom jobIds in any state). `removeOnComplete` drops completed jobs so a later run
   * can re-enqueue the same asset.
   */
  async reprocess(): Promise<{ enqueued: number; total: number; detector: FaceDetectorKind }> {
    const startedAt = new Date().toISOString()
    // ponytail: detector read once per run — jobs enqueued mid-run keep the detector this run saw
    const detector = await this.settings.getFaceDetector()
    const { enqueued, total } = await this.bullMq.enqueuePaged(
      'process-faces',
      're-embed',
      (offset) => this.admin.listForReprocess('photo', REPROCESS_PAGE_SIZE, offset),
      (item) => ({
        data: {
          assetId: item.id,
          fileId: item.fileId,
          userId: item.userId,
          reason: 're-embed',
          detector,
        },
        jobId: `face-reembed-${item.id}`,
      }),
    )
    await this.settings.setFaceReprocessLastRun({ startedAt, total, enqueued, detector })
    return { enqueued, total, detector }
  }

  async status(): Promise<{ lastRun: FaceReprocessLastRun | null; queue: Record<string, number> }> {
    const [lastRun, queue] = await Promise.all([
      this.settings.getFaceReprocessLastRun(),
      this.bullMq.getQueue('process-faces').getJobCounts(),
    ])
    return { lastRun, queue }
  }

  async recluster(): Promise<{ enqueued: number }> {
    const rows: { userId: string }[] = await this.dataSource.query(
      'SELECT DISTINCT "userId" FROM faces',
    )
    const suffix = Date.now()
    for (const row of rows) {
      await this.bullMq.enqueue(
        'process-faces-cluster',
        'cluster',
        { userId: row.userId, reason: 'manual' },
        {
          // unique suffix so a manual run is never deduped against a worker's debounced job
          jobId: `cluster-${row.userId}-admin-${suffix}`,
        },
      )
    }
    return { enqueued: rows.length }
  }
}
