import { type Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { randomUUID } from 'crypto';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import type { DataSource, Repository } from 'typeorm';
import type { LocalStorageService } from '@photox/shared-config';
import { errorMessage } from '../common/errors';
import { BackupRun } from '../database/entities/backup-run.entity';
import { BackupRunItem } from '../database/entities/backup-run-item.entity';
import type { BullMqService } from '../queue/bullmq.service';
import { sha256File } from './backup-storage-io';
import {
  TRANSFER_DISPATCH_BATCH_SIZE,
  TRANSFER_JOB_ATTEMPTS,
  TRANSFER_JOB_BACKOFF_MS,
  TRANSFER_QUEUE_LEASE_MS,
  TRANSFER_QUEUES,
  type TransferJobData,
  type TransferKind,
} from './backup-transfer.constants';
import type { ClaimedBackupItem, TransferJobLike } from './backup.types';
import { rowsOf } from './bulk-io';
import type { RunFinalizeService } from './run-finalize.service';
import { isNotFound, type S3BackupService } from './s3-backup.service';

/** Cap for the run driver's retry backoff when it retries without BullMQ's scheduler. */
const TRANSFER_MAX_BACKOFF_MS = 5 * 60_000;
// ponytail: a claim is a timestamp, not a lease — no owner, no heartbeat — so a transfer that
// outlives this window can be re-queued while the first job still runs. Both sides write the same
// bytes to the same key through tmp+rename, so the cost is duplicate work, never corruption.
// Upgrade to a renewing lease only if a single file can legitimately take this long (the 4 GiB
// upload cap and the 1h transcode cap say it cannot).
/** A crashed core leaves items 'running'; after this they are claimable again. */
const TRANSFER_CLAIM_TIMEOUT_MS = 30 * 60_000;

/**
 * Middle phase: claim due ledger items, hand them to the per-kind BullMQ queues, execute one item
 * per job, and promote a drained run by delegating to the finalize phase.
 */
export class TransferDispatchService {
  constructor(
    private readonly finalize: RunFinalizeService,
    private readonly dataSource: DataSource,
    private readonly bullMq: BullMqService,
    private readonly s3: S3BackupService,
    private readonly storage: LocalStorageService,
    private readonly runs: Repository<BackupRun>,
    private readonly runItems: Repository<BackupRunItem>,
    private readonly logger: Logger,
  ) {}

  async runTransfersOnce(ignoreBackoff = false): Promise<number> {
    await this.requeueStuckFinalizing();
    await this.requeueStaleClaims();
    let consumed = 0;
    for (const kind of Object.keys(TRANSFER_QUEUES) as TransferKind[]) {
      const rows = await this.claimDispatchable(kind, TRANSFER_DISPATCH_BATCH_SIZE, ignoreBackoff);
      for (const row of rows) {
        try {
          await this.consumeTransferJob(kind, {
            data: { runId: row.runId, itemId: row.id },
            attemptsMade: row.attempts,
            opts: { attempts: TRANSFER_JOB_ATTEMPTS },
          });
        } catch {
          // transient: the consumer left the row queued, so own the retry here instead of BullMQ
          const delayMs = ignoreBackoff
            ? 0
            : Math.min(TRANSFER_MAX_BACKOFF_MS, 1000 * 2 ** row.attempts);
          await this.runItems.update(row.id, {
            state: 'retrying',
            nextAttemptAt: new Date(Date.now() + delayMs),
            claimedAt: null,
          });
        }
        consumed += 1;
      }
    }
    await this.finalize.finalizeDueRuns(null);
    return consumed;
  }

  async claimDispatchable(
    kind: TransferKind,
    limit: number,
    ignoreBackoff = false,
  ): Promise<{ id: string; runId: string; attempts: number }[]> {
    const due = ignoreBackoff ? '' : 'AND i2."nextAttemptAt" <= now()';
    const rows = rowsOf<{ id: string; runId: string; attempts: number }>(
      await this.dataSource.query(
        `UPDATE "backup_run_items" i
         SET "state" = 'queued', "claimedAt" = now()
         WHERE i."id" IN (
           SELECT i2."id" FROM "backup_run_items" i2
           JOIN "backup_runs" r ON r."id" = i2."runId"
           WHERE r."state" = 'running' AND r."kind" = $2
             AND i2."state" IN ('pending', 'retrying')
             ${due}
           ORDER BY i2."nextAttemptAt" ASC
           FOR UPDATE OF i2 SKIP LOCKED
           LIMIT $1
         )
         RETURNING i."id" AS "id", i."runId" AS "runId", i."attempts" AS "attempts"`,
        [limit, kind],
      ),
    );
    return rows;
  }

  async dispatchPendingTransfers(
    kind: TransferKind,
    limit = TRANSFER_DISPATCH_BATCH_SIZE,
  ): Promise<number> {
    const rows = await this.claimDispatchable(kind, limit);
    let enqueued = 0;
    for (const row of rows) {
      const ok = await this.bullMq.enqueue(
        TRANSFER_QUEUES[kind],
        'transfer',
        { runId: row.runId, itemId: row.id } satisfies TransferJobData,
        {
          jobId: `${kind}-${row.id}`,
          attempts: TRANSFER_JOB_ATTEMPTS,
          backoff: { type: 'exponential', delay: TRANSFER_JOB_BACKOFF_MS },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      if (ok) {
        enqueued += 1;
      } else {
        // Redis refused the add: put the row back so the next tick retries it
        await this.runItems.update({ id: row.id }, { state: 'pending', claimedAt: null });
      }
    }
    return enqueued;
  }

  async requeueStaleQueued(): Promise<void> {
    await this.dataSource.query(
      `UPDATE "backup_run_items" SET "state" = 'pending', "claimedAt" = NULL
       WHERE "state" = 'queued'
         AND "claimedAt" < now() - ($1::int * interval '1 millisecond')`,
      [TRANSFER_QUEUE_LEASE_MS],
    );
  }

  /** Dispatcher housekeeping: requeue crash leftovers, then finish runs with no items left. */
  async reconcileTransfers(): Promise<void> {
    await this.requeueStuckFinalizing();
    await this.requeueStaleQueued();
    await this.requeueStaleClaims();
    await this.finalize.finalizeDueRuns(null);
  }

  /** Consumer half: one BullMQ job = one file, re-read from the DB before any I/O. */
  async consumeTransferJob(kind: TransferKind, job: TransferJobLike): Promise<void> {
    const data = job.data as Partial<TransferJobData> | undefined;
    if (typeof data?.runId !== 'string' || typeof data?.itemId !== 'string') return;
    if (!isUUID(data.runId) || !isUUID(data.itemId)) return;
    const run = await this.runs.findOne({ where: { id: data.runId } });
    // a job in the wrong queue, or for a terminal run, must never write bytes
    if (run?.kind !== kind) return;
    if (run.state !== 'running' && run.state !== 'paused') return;
    const item = await this.runItems.findOne({ where: { id: data.itemId, runId: run.id } });
    if (!item || item.state === 'failed' || item.state === 'missing') return;
    if (!(await this.claimQueuedItem(item.id, run.id, job.attemptsMade + 1))) return;

    await this.runs.update(run.id, { currentFile: item.storageKey, updatedAt: new Date() });
    try {
      await this.performTransfer(run, item);
      await this.runItems.delete(item.id);
      await this.bumpRun(run.id, 'uploaded');
      await this.finalizeRunIfDone(run.id);
    } catch (err) {
      await this.handleQueueTransferError(run, item, err, job);
    }
  }

  /** Atomic claim for one queued item; a crash-retried job may re-claim its own running row. */
  async claimQueuedItem(itemId: string, runId: string, attempt: number): Promise<boolean> {
    const rows = rowsOf<{ id: string }>(
      await this.dataSource.query(
        `UPDATE "backup_run_items"
         SET "state" = 'running', "claimedAt" = now(), "attempts" = $3
         WHERE "id" = $1 AND "runId" = $2
           AND ("state" IN ('pending', 'retrying', 'queued')
                OR ("state" = 'running' AND "attempts" < $3))
         RETURNING "id"`,
        [itemId, runId, attempt],
      ),
    );
    return rows.length > 0;
  }

  async handleQueueTransferError(
    run: BackupRun,
    item: { id: string },
    err: unknown,
    job: TransferJobLike,
  ): Promise<void> {
    const message = errorMessage(err);
    const code = (err as NodeJS.ErrnoException).code;

    // local storage is full/unwritable: retrying this or other files is pointless — pause the run
    if (code === 'ENOSPC' || code === 'EDQUOT' || code === 'EACCES') {
      await this.runItems.update(item.id, { state: 'queued', claimedAt: null, error: message });
      await this.runs.update(run.id, {
        state: 'paused',
        error: `Transfer paused: ${message}`,
        currentFile: null,
        updatedAt: new Date(),
      });
      this.logger.error(`Transfer paused for run ${run.id}: ${message}`);
      return;
    }

    const missing = run.kind === 'restore' && isNotFound(err);
    const maxAttempts =
      job.opts.attempts !== undefined && job.opts.attempts > 0
        ? job.opts.attempts
        : TRANSFER_JOB_ATTEMPTS;
    const attempts = job.attemptsMade + 1;
    if (missing || code === 'ENOENT' || attempts >= maxAttempts) {
      await this.runItems.update(item.id, {
        state: missing ? 'missing' : 'failed',
        error: message,
        claimedAt: null,
      });
      await this.bumpRun(run.id, 'failed');
      await this.finalizeRunIfDone(run.id);
      this.logger.warn(
        `Transfer ${missing ? 'missing' : 'failed'} (${run.kind}) item=${item.id} ` +
          `run=${run.id}: ${message}`,
      );
      return;
    }

    // transient: hand the item back as dispatchable and let BullMQ's backoff own the retry
    await this.runItems.update(item.id, { state: 'queued', claimedAt: null, error: message });
    this.logger.warn(
      `Transfer retry (${run.kind}) item=${item.id} attempt=${attempts}: ${message}`,
    );
    throw err;
  }

  /** Atomically promote a run with no outstanding items to finalizing, then finish it once. */
  async finalizeRunIfDone(runId: string): Promise<void> {
    const claimed = rowsOf<{ id: string }>(
      await this.dataSource.query(
        `UPDATE "backup_runs" SET "state" = 'finalizing', "updatedAt" = now()
         WHERE "id" = $1 AND "state" = 'running'
           AND NOT EXISTS (
             SELECT 1 FROM "backup_run_items" i
             WHERE i."runId" = $1
               AND i."state" IN ('pending', 'retrying', 'queued', 'running')
           )
         RETURNING "id"`,
        [runId],
      ),
    );
    if (claimed.length === 0) return;
    try {
      await this.finalize.finalizeRun(runId);
    } catch (err) {
      const message = errorMessage(err);
      this.logger.error(`Backup run ${runId} finalize failed: ${message}`);
      await this.finalize.failRun(runId, `Finalize failed: ${message}`);
    }
  }

  /** The actual byte movement shared by the synchronous driver and the queue consumer. */
  async performTransfer(run: BackupRun, item: ClaimedBackupItem): Promise<void> {
    if (run.kind === 'backup') {
      await this.s3.putFile(
        item.s3Key,
        this.storage.pathFor(item.storageKey),
        item.mimeType ?? undefined,
      );
    } else {
      await this.restoreFile(run, item);
    }
  }

  /** A crashed core leaves items claimed; after the timeout they become claimable again. */
  async requeueStaleClaims(): Promise<void> {
    await this.dataSource.query(
      `UPDATE "backup_run_items" SET "state" = 'retrying', "nextAttemptAt" = now()
       WHERE "state" = 'running' AND "claimedAt" < now() - ($1::int * interval '1 millisecond')`,
      [TRANSFER_CLAIM_TIMEOUT_MS],
    );
  }

  /** A crash during finalize leaves a run 'finalizing'; re-drive it once it is clearly stale. */
  async requeueStuckFinalizing(): Promise<void> {
    await this.dataSource.query(
      `UPDATE "backup_runs" SET "state" = 'running', "updatedAt" = now()
       WHERE "state" = 'finalizing' AND "updatedAt" < now() - interval '10 minutes'`,
    );
  }

  async restoreFile(run: BackupRun, item: ClaimedBackupItem): Promise<void> {
    const dir = this.storage.pathFor(join('backup-runs', run.id, 'tmp'));
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `${item.fileId}.${randomUUID()}.part`);
    try {
      await this.s3.downloadToFile(item.s3Key, tmp);
      if (item.checksumSha256) {
        const actual = await sha256File(tmp);
        if (actual !== item.checksumSha256) {
          throw new Error(`checksum mismatch for ${item.fileId}`);
        }
      }
      // atomic save consumes the temp file; a failure leaves the run item retryable
      await this.storage.save(item.storageKey, tmp);
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  async bumpRun(runId: string, outcome: 'uploaded' | 'failed'): Promise<void> {
    const column = outcome === 'uploaded' ? '"uploaded"' : '"failedItems"';
    await this.dataSource.query(
      `UPDATE "backup_runs"
       SET "completedItems" = "completedItems" + 1,
           ${column} = ${column} + 1,
           "currentFile" = NULL,
           "updatedAt" = now()
       WHERE "id" = $1`,
      [runId],
    );
  }
}
