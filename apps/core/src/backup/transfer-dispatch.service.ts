import { ForbiddenException, type Logger } from '@nestjs/common';
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
import type { ClaimedBackupItem, TransferFailure, TransferJobLike } from './backup.types';
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
 * Middle phase: claim due ledger items and hand them to the per-kind BullMQ queues (the worker
 * executes one item per job and reports back over /worker/backups/transfers/*), then promote a
 * drained run by delegating to the finalize phase.
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

  /**
   * One sweeper pass without BullMQ: requeue crashed claims, drive one batch of each kind
   * through the same claim/complete/fail path, then finish runs with nothing left. Test-only
   * driver — production is the queue pair (core dispatcher + worker consumers).
   */
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

  /**
   * Atomic claim of one kind's due items: pending/retrying rows become queued (the lease
   * marker the dispatcher and the local driver both use) and their attempt count comes back
   * so the consumer can decide permanent vs transient without another read.
   */
  private async claimDispatchable(
    kind: TransferKind,
    limit: number,
    ignoreBackoff = false,
  ): Promise<{ id: string; runId: string; userId: string; attempts: number }[]> {
    const due = ignoreBackoff ? '' : 'AND i2."nextAttemptAt" <= now()';
    const rows = rowsOf<{ id: string; runId: string; userId: string; attempts: number }>(
      await this.dataSource.query(
        `UPDATE "backup_run_items" i
         SET "state" = 'queued', "claimedAt" = now()
         FROM "backup_runs" run
         WHERE run."id" = i."runId"
           AND i."id" IN (
           SELECT i2."id" FROM "backup_run_items" i2
           JOIN "backup_runs" r ON r."id" = i2."runId"
           WHERE r."state" = 'running' AND r."kind" = $2
             AND i2."state" IN ('pending', 'retrying')
             ${due}
           ORDER BY i2."nextAttemptAt" ASC
           FOR UPDATE OF i2 SKIP LOCKED
           LIMIT $1
         )
         RETURNING i."id" AS "id", i."runId" AS "runId", i."attempts" AS "attempts",
                   run."userId" AS "userId"`,
        [limit, kind],
      ),
    );
    return rows;
  }

  /**
   * Hands a bounded batch of one kind's due items to its queue. This is the producer half of the
   * BullMQ executor; the DB rows stay the source of truth. The kinds use separate queues and
   * separate advisory locks, so a slow or paused backup never stalls restore dispatch.
   */
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
        { runId: row.runId, itemId: row.id, userId: row.userId } satisfies TransferJobData,
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

  /**
   * A queued row with no job (crash between enqueue and consume, Redis eviction) becomes
   * dispatchable again. Re-adding an item that still has a live job is a no-op (jobId dedupe).
   */
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

  /**
   * Claim phase shared by the HTTP claim route and the in-process driver: validates the job
   * against the ledger and atomically turns one item `running`. A returned item is the only
   * licence to move bytes.
   */
  async claimTransfer(
    kind: TransferKind,
    runId: string,
    itemId: string,
    attempt: number,
    userId?: string,
  ): Promise<{ run: BackupRun; item: BackupRunItem } | null> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) return null;
    this.assertJobUser(run, userId);
    // a job in the wrong queue, or for a terminal run, must never write bytes
    if (run.kind !== kind) return null;
    if (run.state !== 'running' && run.state !== 'paused') return null;
    const item = await this.runItems.findOne({ where: { id: itemId, runId: run.id } });
    if (!item || item.state === 'failed' || item.state === 'missing') return null;
    if (!(await this.claimQueuedItem(item.id, run.id, attempt))) return null;

    await this.runs.update(run.id, { currentFile: item.storageKey, updatedAt: new Date() });
    return { run, item };
  }

  /**
   * Success half: delete the ledger row and bump the run exactly once, then let finalize decide.
   * A re-delivered complete (lost HTTP response) is a no-op.
   */
  async completeTransfer(runId: string, itemId: string, userId?: string): Promise<void> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) return;
    this.assertJobUser(run, userId);
    const deleted = await this.runItems.delete({ id: itemId, runId });
    if (!deleted.affected) return;
    await this.bumpRun(runId, 'uploaded');
    await this.finalize.finalizeDueRuns(runId);
  }

  /**
   * Failure half: decides pause (local FS full/unwritable), permanent failure (missing source
   * or last attempt) or a BullMQ retry, and returns whether the worker must throw.
   */
  async failTransfer(
    kind: TransferKind,
    runId: string,
    itemId: string,
    failure: TransferFailure,
    userId?: string,
  ): Promise<boolean> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) return false;
    this.assertJobUser(run, userId);
    if (run.kind !== kind) return false;
    const item = await this.runItems.findOne({ where: { id: itemId, runId } });
    if (!item) return false;
    return this.handleTransferError(run, item, failure);
  }

  /** Queue-bound worker routes name the run's owner; core's in-process driver does not. */
  private assertJobUser(run: BackupRun, userId?: string): void {
    if (userId !== undefined && run.userId !== userId) {
      throw new ForbiddenException('Transfer target must be the job user');
    }
  }

  /** Consumer half of the in-process driver: one item, claim → bytes → ledger. */
  async consumeTransferJob(kind: TransferKind, job: TransferJobLike): Promise<void> {
    const data = job.data as Partial<TransferJobData> | undefined;
    if (typeof data?.runId !== 'string' || typeof data?.itemId !== 'string') return;
    if (!isUUID(data.runId) || !isUUID(data.itemId)) return;
    const claimed = await this.claimTransfer(kind, data.runId, data.itemId, job.attemptsMade + 1);
    if (!claimed) return;

    try {
      await this.performTransfer(kind, data.runId, claimed.item);
    } catch (err) {
      // ledger bookkeeping below is outside this try: a DB hiccup after the bytes landed must
      // never mark the item failed
      const retry = await this.handleTransferError(claimed.run, claimed.item, {
        message: errorMessage(err),
        code: (err as NodeJS.ErrnoException).code,
        errorName: (err as { name?: string }).name,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? TRANSFER_JOB_ATTEMPTS,
      });
      if (retry) throw err;
      return;
    }
    await this.completeTransfer(data.runId, claimed.item.id);
  }

  /** Atomic claim for one queued item; a crash-retried job may re-claim its own running row. */
  private async claimQueuedItem(itemId: string, runId: string, attempt: number): Promise<boolean> {
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

  private async handleTransferError(
    run: BackupRun,
    item: { id: string },
    failure: TransferFailure,
  ): Promise<boolean> {
    const message = failure.message;

    // local storage is full/unwritable: retrying this or other files is pointless — pause the run
    if (failure.code === 'ENOSPC' || failure.code === 'EDQUOT' || failure.code === 'EACCES') {
      await this.runItems.update(item.id, { state: 'queued', claimedAt: null, error: message });
      await this.runs.update(run.id, {
        state: 'paused',
        error: `Transfer paused: ${message}`,
        currentFile: null,
        updatedAt: new Date(),
      });
      this.logger.error(`Transfer paused for run ${run.id}: ${message}`);
      return false;
    }

    const missing = run.kind === 'restore' && isNotFound({ name: failure.errorName });
    if (missing || failure.code === 'ENOENT' || failure.attempt >= failure.maxAttempts) {
      await this.runItems.update(item.id, {
        state: missing ? 'missing' : 'failed',
        error: message,
        claimedAt: null,
      });
      await this.bumpRun(run.id, 'failed');
      await this.finalize.finalizeDueRuns(run.id);
      this.logger.warn(
        `Transfer ${missing ? 'missing' : 'failed'} (${run.kind}) item=${item.id} ` +
          `run=${run.id}: ${message}`,
      );
      return false;
    }

    // transient: hand the item back as dispatchable and let BullMQ's backoff own the retry
    await this.runItems.update(item.id, { state: 'queued', claimedAt: null, error: message });
    this.logger.warn(
      `Transfer retry (${run.kind}) item=${item.id} attempt=${failure.attempt}: ${message}`,
    );
    return true;
  }

  /** The actual byte movement shared by the synchronous driver and the worker's transfer job. */
  private async performTransfer(
    kind: TransferKind,
    runId: string,
    item: ClaimedBackupItem,
  ): Promise<void> {
    if (kind === 'backup') {
      await this.s3.putFile(
        item.s3Key,
        this.storage.pathFor(item.storageKey),
        item.mimeType ?? undefined,
      );
    } else {
      await this.restoreFile(runId, item);
    }
  }

  /** A crashed core leaves items claimed; after the timeout they become claimable again. */
  private async requeueStaleClaims(): Promise<void> {
    await this.dataSource.query(
      `UPDATE "backup_run_items" SET "state" = 'retrying', "nextAttemptAt" = now()
       WHERE "state" = 'running' AND "claimedAt" < now() - ($1::int * interval '1 millisecond')`,
      [TRANSFER_CLAIM_TIMEOUT_MS],
    );
  }

  /** A crash during finalize leaves a run 'finalizing'; re-drive it once it is clearly stale. */
  private async requeueStuckFinalizing(): Promise<void> {
    await this.dataSource.query(
      `UPDATE "backup_runs" SET "state" = 'running', "updatedAt" = now()
       WHERE "state" = 'finalizing' AND "updatedAt" < now() - interval '10 minutes'`,
    );
  }

  private async restoreFile(runId: string, item: ClaimedBackupItem): Promise<void> {
    const dir = this.storage.pathFor(join('backup-runs', runId, 'tmp'));
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

  private async bumpRun(runId: string, outcome: 'uploaded' | 'failed'): Promise<void> {
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
