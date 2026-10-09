import { Injectable } from '@nestjs/common'
import { SEARCH_EMBEDDING_MODEL, type AdminAssetReprocessRow } from '@photox/shared-types'
import { AdminAssetsService } from './admin-assets.service'
import { BullMqService } from '../queue/bullmq.service'
import type { LastRun } from '../settings/settings.service'
import { SettingsService } from '../settings/settings.service'
import { reprocessPhotos, reprocessStatus } from './reprocess.util'

/** Job data shared by the ocr/detect/embed reprocess jobs. */
function reprocessData(item: AdminAssetReprocessRow): Record<string, unknown> {
  return { assetId: item.id, fileId: item.fileId, userId: item.userId, reason: 'reprocess' }
}

/**
 * ponytail: the `-reprocess` suffix keeps backfill jobs from deduping against upload-path jobs
 * (`ocr-<assetId>` / `detect-<assetId>` / `embed-<assetId>-<model>`); `removeOnComplete` (see
 * reprocessPhotos) lets a later run re-enqueue the same asset.
 */
@Injectable()
export class AdminReprocessService {
  constructor(
    private readonly admin: AdminAssetsService,
    private readonly bullMq: BullMqService,
    private readonly settings: SettingsService,
  ) {}

  reprocessOcr(): Promise<{ enqueued: number; total: number }> {
    return reprocessPhotos(
      { admin: this.admin, bullMq: this.bullMq },
      'process-ocr',
      'ocr',
      (item) => ({ data: reprocessData(item), jobId: `ocr-reprocess-${item.id}` }),
      (run) => this.settings.setLastRun('ocr', run),
    )
  }

  ocrStatus(): Promise<{ lastRun: LastRun<'ocr'> | null; queue: Record<string, number> }> {
    return reprocessStatus(this.bullMq, 'process-ocr', () => this.settings.getLastRun('ocr'))
  }

  reprocessDetections(): Promise<{ enqueued: number; total: number }> {
    return reprocessPhotos(
      { admin: this.admin, bullMq: this.bullMq },
      'process-detect',
      'detect',
      (item) => ({ data: reprocessData(item), jobId: `detect-reprocess-${item.id}` }),
      (run) => this.settings.setLastRun('detections', run),
    )
  }

  detectionsStatus(): Promise<{
    lastRun: LastRun<'detections'> | null
    queue: Record<string, number>
  }> {
    return reprocessStatus(this.bullMq, 'process-detect', () =>
      this.settings.getLastRun('detections'),
    )
  }

  reprocessEmbeddings(): Promise<{ enqueued: number; total: number }> {
    return reprocessPhotos(
      { admin: this.admin, bullMq: this.bullMq },
      'process-embeddings',
      'embed',
      (item) => ({
        data: reprocessData(item),
        jobId: `embed-reprocess-${item.id}-${SEARCH_EMBEDDING_MODEL}`,
      }),
      (run) => this.settings.setLastRun('embedding', { ...run, model: SEARCH_EMBEDDING_MODEL }),
    )
  }

  embeddingsStatus(): Promise<{
    lastRun: LastRun<'embedding'> | null
    queue: Record<string, number>
  }> {
    return reprocessStatus(this.bullMq, 'process-embeddings', () =>
      this.settings.getLastRun('embedding'),
    )
  }
}
