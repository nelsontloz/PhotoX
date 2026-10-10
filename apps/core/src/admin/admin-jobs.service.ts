import { Injectable, Logger } from '@nestjs/common'
import { DataSource } from 'typeorm'
import {
  SEARCH_EMBEDDING_MODEL,
  type AdminAssetReprocessRow,
  type FaceDetectorKind,
} from '@photox/shared-types'
import { AdminAssetsService } from './admin-assets.service'
import { BullMqService } from '../queue/bullmq.service'
import { PlacesResolveService } from '../places/places-resolve.service'
import type { LastRun } from '../settings/settings.service'
import { SettingsService } from '../settings/settings.service'
import { REPROCESS_PAGE_SIZE, reprocessPhotos, reprocessStatus } from './reprocess.util'

const METADATA_QUEUE = 'process-metadata'
const BACKFILL_PAGE_SIZE = 500

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
export class AdminJobsService {
  private readonly logger = new Logger(AdminJobsService.name)

  constructor(
    private readonly admin: AdminAssetsService,
    private readonly bullMq: BullMqService,
    private readonly settings: SettingsService,
    private readonly dataSource: DataSource,
    private readonly places: PlacesResolveService,
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

  // ponytail: detector read once per run — jobs enqueued mid-run keep the detector this run saw
  async reprocessFaces(): Promise<{ enqueued: number; total: number; detector: FaceDetectorKind }> {
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

  faceStatus(): Promise<{
    lastRun: LastRun<'face'> | null
    queue: Record<string, number>
  }> {
    return reprocessStatus(this.bullMq, 'process-faces', () => this.settings.getLastRun('face'))
  }

  async reclusterFaces(): Promise<{ enqueued: number }> {
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

  /**
   * ponytail: keyset paging, not offset — completed jobs set phash and shrink the `phash IS NULL`
   * set, so an offset loop would skip rows. `enqueued` counts requested jobs, not new Redis
   * entries (`enqueue` swallows Redis failures, and a custom jobId dedupes in any state). The
   * upload path enqueues process-metadata with no explicit jobId, so the `metadata-reprocess-`
   * prefix can never collide with an in-flight upload; `removeOnComplete` drops completed jobs so
   * a later run can re-enqueue the same asset.
   */
  async reprocessMetadata(): Promise<{ enqueued: number; total: number }> {
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

  metadataStatus(): Promise<{
    lastRun: LastRun<'metadata'> | null
    queue: Record<string, number>
  }> {
    return reprocessStatus(this.bullMq, METADATA_QUEUE, () => this.settings.getLastRun('metadata'))
  }

  /**
   * Inline loop, no queue: one indexed KNN lookup per asset, all inside core's DB.
   * ponytail: assets whose nearest city is >50km away stay unresolved and are re-visited on the
   * next run — harmless at personal-library scale.
   */
  async backfillPlaces(): Promise<{ updated: number; total: number }> {
    const startedAt = new Date().toISOString()
    const total = await this.admin.countUnresolvedPlaces()
    let afterId: string | null = null
    let updated = 0
    for (;;) {
      const page = await this.admin.listUnresolvedPlaces(BACKFILL_PAGE_SIZE, afterId)
      if (page.items.length === 0) break
      for (const item of page.items) {
        try {
          const place = await this.places.resolve(Number(item.latitude), Number(item.longitude))
          if (place) {
            await this.admin.applyPlaceFields(item.id, place)
            updated++
          }
        } catch (err) {
          this.logger.warn(`place backfill failed for asset ${item.id}: ${String(err)}`)
        }
      }
      afterId = page.items[page.items.length - 1]!.id
    }
    await this.settings.setLastRun('places', { startedAt, total, updated })
    return { updated, total }
  }

  async placesStatus(): Promise<{ lastRun: LastRun<'places'> | null }> {
    return { lastRun: await this.settings.getLastRun('places') }
  }
}
