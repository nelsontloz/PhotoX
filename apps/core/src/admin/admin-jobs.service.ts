import { Injectable, Logger } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { SEARCH_EMBEDDING_MODEL, type AdminAssetReprocessRow } from '@photox/shared-types'
import { AdminAssetsService } from './admin-assets.service'
import { BullMqService } from '../queue/bullmq.service'
import { PlacesResolveService } from '../places/places-resolve.service'
import type { EnqueuedRun, LastRun } from '../settings/settings.service'
import { SettingsService } from '../settings/settings.service'
import { REPROCESS_PAGE_SIZE } from './reprocess.util'

const METADATA_QUEUE = 'process-metadata'
const BACKFILL_PAGE_SIZE = 500

/** Reprocess status kinds; each maps to one queue and one stored last-run record. */
type ReprocessKind = 'detections' | 'embedding' | 'face' | 'metadata'

const REPROCESS_QUEUES: Record<ReprocessKind, string> = {
  detections: 'process-detect',
  embedding: 'process-embeddings',
  face: 'process-faces',
  metadata: METADATA_QUEUE,
}

/** Job data shared by the detect/embed reprocess jobs. */
function reprocessData(item: AdminAssetReprocessRow): Record<string, unknown> {
  return { assetId: item.id, fileId: item.fileId, userId: item.userId, reason: 'reprocess' }
}

/**
 * ponytail: the `-reprocess` suffix keeps backfill jobs from deduping against upload-path jobs
 * (`detect-<assetId>` / `embed-<assetId>-<model>`); `removeOnComplete` (see reprocessPhotos)
 * lets a later run re-enqueue the same asset.
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

  /**
   * Shared paged reprocess: enqueue one job per non-trashed photo, then hand the run counts to
   * `saveLastRun` (kind-specific fields like model are merged there).
   * ponytail: `enqueued` counts requested jobs, not new Redis entries — `enqueue` swallows Redis
   * failures and a custom jobId dedupes in any state (BullMQ); `removeOnComplete` in
   * `enqueuePaged` drops completed jobs so a later run can re-enqueue the same asset.
   */
  private async reprocessPhotos(
    queue: string,
    jobName: string,
    build: (item: AdminAssetReprocessRow) => { data: Record<string, unknown>; jobId: string },
    saveLastRun: (run: EnqueuedRun) => Promise<void>,
  ): Promise<{ enqueued: number; total: number }> {
    const startedAt = new Date().toISOString()
    const { enqueued, total } = await this.bullMq.enqueuePaged(
      queue,
      jobName,
      (offset) => this.admin.listForReprocess('photo', REPROCESS_PAGE_SIZE, offset),
      build,
    )
    await saveLastRun({ startedAt, total, enqueued })
    return { enqueued, total }
  }

  reprocessDetections(): Promise<{ enqueued: number; total: number }> {
    return this.reprocessPhotos(
      'process-detect',
      'detect',
      (item) => ({ data: reprocessData(item), jobId: `detect-reprocess-${item.id}` }),
      (run) => this.settings.setLastRun('detections', run),
    )
  }

  /** Stored last-run record plus the queue's job counts. */
  async status<K extends ReprocessKind>(
    kind: K,
  ): Promise<{ lastRun: LastRun<K> | null; queue: Record<string, number> }> {
    const [lastRun, queue] = await Promise.all([
      this.settings.getLastRun(kind),
      this.bullMq.getQueue(REPROCESS_QUEUES[kind]).getJobCounts(),
    ])
    return { lastRun, queue }
  }

  reprocessEmbeddings(): Promise<{ enqueued: number; total: number }> {
    return this.reprocessPhotos(
      'process-embeddings',
      'embed',
      (item) => ({
        data: reprocessData(item),
        jobId: `embed-reprocess-${item.id}-${SEARCH_EMBEDDING_MODEL}`,
      }),
      (run) => this.settings.setLastRun('embedding', { ...run, model: SEARCH_EMBEDDING_MODEL }),
    )
  }

  async reprocessFaces(): Promise<{ enqueued: number; total: number }> {
    return this.reprocessPhotos(
      'process-faces',
      're-embed',
      (item) => ({
        data: {
          assetId: item.id,
          fileId: item.fileId,
          userId: item.userId,
          reason: 're-embed',
        },
        jobId: `face-reembed-${item.id}`,
      }),
      (run) => this.settings.setLastRun('face', run),
    )
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
