import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserFilesService } from '../files/user/user-files.service';

export const STUCK_ASSET_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
// A healthy upload enqueues its jobs inside the same request, so anything still `pending` after
// this long lost its jobs (Redis refused them, or the process died between commit and enqueue).
export const STUCK_ASSET_AGE_MINUTES = 15;
const STUCK_ASSET_BATCH = 50;
// arbitrary fixed key, distinct from the upload (…003) and backup (…004/…005) locks
const STUCK_ASSET_LOCK_KEY = 728461006;

interface StuckAssetRow {
  id: string;
  fileId: string;
  userId: string;
  kind: 'photo' | 'video';
}

/**
 * Re-enqueues media jobs for assets whose rows committed but whose jobs never ran. The enqueue path
 * is best-effort by design (rows first, then Redis), and only the client retrying closes the gap —
 * this sweeper is the backstop for clients that never come back.
 *
 * ponytail: plain setInterval + pg_try_advisory_lock, same shape as the upload sweeper. Re-enqueue
 * is safe because every jobId is derived from the asset (`thumb*`, `meta`-free `process-metadata`
 * is idempotent, `embed-`/`detect-`), so a live job absorbs the duplicate. Only `pending`
 * metadataStatus is selected: a worker that ran and failed marks `failed`, so this cannot loop on
 * permanently broken media.
 */
@Injectable()
export class StuckAssetsSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StuckAssetsSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly userFiles: UserFilesService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`[StuckAssetsSweeper] sweep failed: ${message}`);
      });
    }, STUCK_ASSET_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<{ requeued: number; skipped?: boolean }> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const locked = (await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        STUCK_ASSET_LOCK_KEY,
      ])) as { locked: boolean }[];
      if (locked[0]?.locked !== true) return { requeued: 0, skipped: true };
      try {
        const rows = await this.dataSource.query<StuckAssetRow[]>(
          `SELECT id, "fileId", "userId", kind FROM assets
           WHERE "metadataStatus" = 'pending'
             AND "isTrashed" = false
             AND "uploadedAt" < now() - ($1::int * interval '1 minute')
           ORDER BY "uploadedAt" ASC
           LIMIT $2`,
          [STUCK_ASSET_AGE_MINUTES, STUCK_ASSET_BATCH],
        );

        let requeued = 0;
        for (const row of rows) {
          try {
            await this.userFiles.enqueueAssetJobs(row.userId, { id: row.fileId }, row.kind, row.id);
            requeued += 1;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`[StuckAssetsSweeper] re-enqueue failed asset=${row.id}: ${message}`);
          }
        }
        if (requeued > 0) {
          this.logger.log(`[StuckAssetsSweeper] re-enqueued ${requeued} stuck asset(s)`);
        }
        return { requeued };
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [STUCK_ASSET_LOCK_KEY]);
      }
    } finally {
      await runner.release();
    }
  }
}
