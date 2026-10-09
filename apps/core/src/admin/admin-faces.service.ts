import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { FaceDetectorKind } from '@photox/shared-types'
import { AdminAssetsService } from './admin-assets.service'
import { BullMqService } from '../queue/bullmq.service'
import type { LastRun } from '../settings/settings.service'
import { SettingsService } from '../settings/settings.service'
import { reprocessPhotos, reprocessStatus } from './reprocess.util'

@Injectable()
export class AdminFacesService {
  constructor(
    private readonly admin: AdminAssetsService,
    private readonly bullMq: BullMqService,
    private readonly settings: SettingsService,
    private readonly dataSource: DataSource,
  ) {}

  // ponytail: detector read once per run — jobs enqueued mid-run keep the detector this run saw
  async reprocess(): Promise<{ enqueued: number; total: number; detector: FaceDetectorKind }> {
    const detector = await this.settings.getFaceDetector()
    const { enqueued, total } = await reprocessPhotos(
      { admin: this.admin, bullMq: this.bullMq },
      'process-faces',
      're-embed',
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
      (run) => this.settings.setLastRun('face', { ...run, detector }),
    )
    return { enqueued, total, detector }
  }

  status(): Promise<{ lastRun: LastRun<'face'> | null; queue: Record<string, number> }> {
    return reprocessStatus(this.bullMq, 'process-faces', () => this.settings.getLastRun('face'))
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
