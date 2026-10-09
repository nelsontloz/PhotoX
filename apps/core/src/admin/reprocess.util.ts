import type { AdminAssetReprocessRow } from '@photox/shared-types'
import type { AdminAssetsService } from './admin-assets.service'
import type { BullMqService } from '../queue/bullmq.service'
import type { EnqueuedRun } from '../settings/settings.service'

export const REPROCESS_PAGE_SIZE = 500

/**
 * Shared paged reprocess: enqueue one job per non-trashed photo, then hand the run counts to the
 * caller's `saveLastRun` (kind-specific fields like detector/model are merged there).
 * ponytail: `enqueued` counts requested jobs, not new Redis entries — `enqueue` swallows Redis
 * failures and a custom jobId dedupes in any state (BullMQ); `removeOnComplete` in `enqueuePaged`
 * drops completed jobs so a later run can re-enqueue the same asset.
 */
export async function reprocessPhotos(
  deps: { admin: AdminAssetsService; bullMq: BullMqService },
  queue: string,
  jobName: string,
  build: (item: AdminAssetReprocessRow) => { data: Record<string, unknown>; jobId: string },
  saveLastRun: (run: EnqueuedRun) => Promise<void>,
): Promise<{ enqueued: number; total: number }> {
  const startedAt = new Date().toISOString()
  const { enqueued, total } = await deps.bullMq.enqueuePaged(
    queue,
    jobName,
    (offset) => deps.admin.listForReprocess('photo', REPROCESS_PAGE_SIZE, offset),
    build,
  )
  await saveLastRun({ startedAt, total, enqueued })
  return { enqueued, total }
}

/** Shared reprocess status: the stored last-run record plus the queue's job counts. */
export async function reprocessStatus<L>(
  bullMq: BullMqService,
  queue: string,
  getLastRun: () => Promise<L | null>,
): Promise<{ lastRun: L | null; queue: Record<string, number> }> {
  const [lastRun, jobCounts] = await Promise.all([
    getLastRun(),
    bullMq.getQueue(queue).getJobCounts(),
  ])
  return { lastRun, queue: jobCounts }
}
