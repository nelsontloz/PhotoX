import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BACKUP_DISPATCH_LOCK_KEY,
  RESTORE_DISPATCH_LOCK_KEY,
  TRANSFER_DISPATCH_BATCH_SIZE,
  TRANSFER_DISPATCH_INTERVAL_MS,
  type TransferKind,
} from './backup-transfer.constants';
import { UserBackupService } from './user-backup.service';

const DISPATCH_LOCKS: Record<TransferKind, number> = {
  backup: BACKUP_DISPATCH_LOCK_KEY,
  restore: RESTORE_DISPATCH_LOCK_KEY,
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Producer half of the backup/restore queues. One tick reconciles crash leftovers, then hands a
 * bounded batch of each kind's due items to its own queue under its own advisory lock. A full
 * batch schedules the next tick immediately, so a multi-GB run never waits on the interval.
 *
 * Nothing here touches S3 or the filesystem; the queue consumers do the transfer.
 */
@Injectable()
export class BackupTransfersDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupTransfersDispatcher.name);
  private timer?: NodeJS.Timeout;
  private readonly ticking = new Set<TransferKind>();
  private reconciling = false;

  constructor(
    private readonly backups: UserBackupService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    // integration specs drive the same runs synchronously; a live timer would race them
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), TRANSFER_DISPATCH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Reconciliation plus both dispatch lanes; a failing kind never stops the other. */
  async tick(): Promise<void> {
    if (!this.reconciling) {
      this.reconciling = true;
      try {
        await this.backups.reconcileTransfers();
      } catch (err) {
        this.logger.error(`[backup-transfers] reconcile failed: ${messageOf(err)}`);
      } finally {
        this.reconciling = false;
      }
    }
    await Promise.all([this.dispatch('backup'), this.dispatch('restore')]);
  }

  private async dispatch(kind: TransferKind): Promise<void> {
    if (this.ticking.has(kind)) return;
    this.ticking.add(kind);
    let processed = 0;
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows = (await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        DISPATCH_LOCKS[kind],
      ])) as { locked: boolean }[];
      if (rows[0]?.locked !== true) return;
      try {
        processed = await this.backups.dispatchPendingTransfers(kind, TRANSFER_DISPATCH_BATCH_SIZE);
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [DISPATCH_LOCKS[kind]]);
      }
    } catch (err) {
      this.logger.error(`[backup-transfers] ${kind} dispatch failed: ${messageOf(err)}`);
    } finally {
      await runner.release();
      this.ticking.delete(kind);
    }
    // a full batch means more work is due: do not wait for the next interval
    if (processed > 0) setImmediate(() => void this.dispatch(kind));
  }
}
