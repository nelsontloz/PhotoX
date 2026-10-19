import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { UploadsService } from './uploads.service'

export const UPLOAD_SWEEP_INTERVAL_MS = 15 * 60 * 1000

// arbitrary fixed key — pg_try_advisory_lock is cluster-wide, so with more than one core
// instance exactly one of them sweeps at a time (the lock also covers a sweep mid-flight)
const UPLOAD_SWEEP_LOCK_KEY = 728461003

/**
 * Periodically parks expired upload sessions (pending > 24h, assembled > 6h, failed > 24h) and
 * removes their bytes.
 *
 * ponytail: plain setInterval, no scheduler dependency — every instance runs its own unref'd
 * 15-min timer and pg_try_advisory_lock serializes the actual sweeps; upgrade to a real scheduler
 * only if per-instance jitter or clock ticks ever matter. Access-time expiry (GET/PUT/complete)
 * handles the common cases; this is the backstop for sessions nobody ever comes back to.
 */
@Injectable()
export class UploadSessionsSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadSessionsSweeper.name)
  private timer?: NodeJS.Timeout

  constructor(
    private readonly uploads: UploadsService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error(`[UploadSessionsSweeper] sweep failed: ${message}`)
      })
    }, UPLOAD_SWEEP_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /**
   * One sweep guarded by an advisory lock. The lock must live on a single pinned connection —
   * un/lock on different pooled connections would leave it stuck for the pool's lifetime.
   */
  async sweep(): Promise<{ expired: number; skipped?: boolean }> {
    const runner = this.dataSource.createQueryRunner()
    await runner.connect()
    try {
      const rows = (await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        UPLOAD_SWEEP_LOCK_KEY,
      ])) as { locked: boolean }[]
      if (rows[0]?.locked !== true) return { expired: 0, skipped: true }
      try {
        return await this.uploads.purgeExpired()
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [UPLOAD_SWEEP_LOCK_KEY])
      }
    } finally {
      await runner.release()
    }
  }
}
