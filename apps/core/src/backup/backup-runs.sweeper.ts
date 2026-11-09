import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserBackupService } from './user-backup.service';

export const BACKUP_SWEEP_INTERVAL_MS = 1000;

// Fixed key: pg_try_advisory_lock is cluster-wide, so two core instances never process the same
// transfer batch (claim SQL also uses SKIP LOCKED, so the lock is only a throughput guard).
const BACKUP_SWEEP_LOCK_KEY = 728461004;

/**
 * Drives the per-file backup/restore ledger. One batch per tick; a full batch schedules the next
 * tick immediately so a multi-GB run does not wait on the interval. Idle ticks cost one advisory
 * lock + one indexed query per second.
 *
 * ponytail: plain setInterval, no scheduler dependency (precedent: UploadSessionsSweeper) —
 * `GET /admin/backups/progress` and the run status endpoint remain the source of truth for the UI.
 */
@Injectable()
export class BackupRunsSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupRunsSweeper.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly backups: UserBackupService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    // integration specs drive the same runs synchronously via backupUser/restoreUser; a live
    // timer would race them inside one spec database
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), BACKUP_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One advisory-locked batch; chain the next tick immediately when work was found. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    let processed = 0;
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows = (await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        BACKUP_SWEEP_LOCK_KEY,
      ])) as { locked: boolean }[];
      if (rows[0]?.locked !== true) return;
      try {
        processed = await this.backups.runTransfersOnce();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [BACKUP_SWEEP_LOCK_KEY]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[BackupRunsSweeper] sweep failed: ${message}`);
    } finally {
      await runner.release();
      this.ticking = false;
    }
    if (processed > 0) setImmediate(() => void this.tick());
  }
}
