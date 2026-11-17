import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import type {
  TransferClaim,
  TransferFinishRequest,
  TransferFinishResult,
} from '@photox/shared-types';
import { BackupRun } from '../database/entities/backup-run.entity';
import { BackupRunItem } from '../database/entities/backup-run-item.entity';
import { BullMqService } from '../queue/bullmq.service';
import {
  TRANSFER_DISPATCH_BATCH_SIZE,
  TRANSFER_JOB_ATTEMPTS,
  TRANSFER_JOB_BACKOFF_MS,
  TRANSFER_QUEUE_LEASE_MS,
  TRANSFER_QUEUES,
  type TransferJobData,
  type TransferKind,
} from './backup-transfer.constants';
import { rowsOf } from './bulk-io';
import { RunFinalizeService } from './run-finalize.service';

// ponytail: a claim is a timestamp, not a lease — no owner, no heartbeat — so a transfer that
// outlives this window can be re-queued while the first job still runs. Both sides write the same
// bytes to the same key through tmp+rename, so the cost is duplicate work, never corruption.
// Upgrade to a renewing lease only if a single file can legitimately take this long (the 4 GiB
// upload cap and the 1h transcode cap say it cannot).
/** A crashed core/worker leaves items 'running'; after this they are claimable again. */
const TRANSFER_CLAIM_TIMEOUT_MS = 30 * 60_000;

/**
 * Middle phase: claim due ledger items and hand them to the per-kind BullMQ queues, then serve
 * the worker's claim/finish calls for one item per job and promote a drained run by delegating
 * to the finalize phase.
 */
@Injectable()
export class TransferDispatchService {
  private readonly logger = new Logger(TransferDispatchService.name);

  constructor(
    private readonly finalize: RunFinalizeService,
    private readonly dataSource: DataSource,
    private readonly bullMq: BullMqService,
    @InjectRepository(BackupRun) private readonly runs: Repository<BackupRun>,
    @InjectRepository(BackupRunItem) private readonly runItems: Repository<BackupRunItem>,
  ) {}

  /**
   * Atomic claim of one kind's due items: pending/retrying rows become queued (the lease
   * marker the dispatcher and the local driver both use) and their attempt count comes back
   * so the executor can decide permanent vs transient without another read.
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
         FROM "backup_runs" r
         WHERE r."id" = i."runId"
           AND i."id" IN (
             SELECT i2."id" FROM "backup_run_items" i2
             JOIN "backup_runs" r2 ON r2."id" = i2."runId"
             WHERE r2."state" = 'running' AND r2."kind" = $2
               AND i2."state" IN ('pending', 'retrying')
               ${due}
             ORDER BY i2."nextAttemptAt" ASC
             FOR UPDATE OF i2 SKIP LOCKED
             LIMIT $1
           )
         RETURNING i."id" AS "id", i."runId" AS "runId", r."userId" AS "userId",
                   i."attempts" AS "attempts"`,
        [limit, kind],
      ),
    );
    return rows;
  }

  /**
   * Claim half of the local test driver: production dispatch hands rows to BullMQ
   * (`dispatchPendingTransfers`), while the integration harness claims here and drives the
   * worker's own claim/finish calls against them.
   */
  async claimDueTransfers(
    kind: TransferKind,
    limit: number,
    ignoreBackoff = false,
  ): Promise<{ runId: string; itemId: string; userId: string; attempts: number }[]> {
    const rows = await this.claimDispatchable(kind, limit, ignoreBackoff);
    return rows.map((row) => ({
      runId: row.runId,
      itemId: row.id,
      userId: row.userId,
      attempts: row.attempts,
    }));
  }

  /**
   * Hands a bounded batch of one kind's due items to its queue. This is the producer half of the
   * executor; the DB rows stay the source of truth. The kinds use separate queues and separate
   * advisory locks, so a slow or paused backup never stalls restore dispatch.
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
   * Worker half, claim: re-read the row under the job's user scope and hand back the work
   * descriptor. A wrong kind, a terminal run, a settled item or a lost race returns null —
   * the worker never writes bytes it did not claim.
   */
  async claimTransfer(
    kind: TransferKind,
    userId: string,
    runId: string,
    itemId: string,
    attempt: number,
  ): Promise<TransferClaim | null> {
    const run = await this.runs.findOne({ where: { id: runId, userId } });
    if (run?.kind !== kind) return null;
    if (run.state !== 'running' && run.state !== 'paused') return null;
    const item = await this.runItems.findOne({ where: { id: itemId, runId: run.id } });
    if (!item || item.state === 'failed' || item.state === 'missing') return null;
    if (!(await this.claimQueuedItem(item.id, run.id, attempt))) return null;

    await this.runs.update(run.id, { currentFile: item.storageKey, updatedAt: new Date() });
    return {
      kind,
      runId: run.id,
      itemId: item.id,
      fileId: item.fileId,
      storageKey: item.storageKey,
      s3Key: item.s3Key,
      checksumSha256: item.checksumSha256,
      mimeType: item.mimeType,
    };
  }

  /**
   * Worker half, finish: the worker moved the bytes (or failed to) and core records it in the
   * ledger. Never byte-level I/O here, so a worker restart can only re-run an item.
   */
  async finishTransfer(
    kind: TransferKind,
    userId: string,
    runId: string,
    itemId: string,
    request: TransferFinishRequest,
  ): Promise<TransferFinishResult> {
    const run = await this.runs.findOne({ where: { id: runId, userId } });
    if (run?.kind !== kind) return { retry: false };
    if (run.state !== 'running' && run.state !== 'paused') return { retry: false };
    const item = await this.runItems.findOne({ where: { id: itemId, runId: run.id } });
    // a success deletes its row, so a repeated finish must be a 200 no-op
    if (!item) return { retry: false };

    if (request.ok) {
      // the failure record stays: a late success must not erase a settled item
      if (item.state === 'failed' || item.state === 'missing') return { retry: false };
      await this.runItems.delete(item.id);
      await this.bumpRun(run.id, 'uploaded');
      // not gated on the run state: a run paused while this item was in flight still records it
      await this.finalize.finalizeDueRuns(run.id);
      return { retry: false };
    }
    return this.applyTransferFailure(run, item, request);
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

  private async applyTransferFailure(
    run: BackupRun,
    item: { id: string },
    request: TransferFinishRequest,
  ): Promise<TransferFinishResult> {
    const message = request.errorMessage ?? request.errorCode ?? 'transfer failed';
    const code = request.errorCode;

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
      return { retry: false };
    }

    const missing =
      run.kind === 'restore' &&
      (code === 'NotFound' || code === 'NoSuchKey' || code === 'NoSuchBucket');
    if (missing || code === 'ENOENT' || request.attempt >= TRANSFER_JOB_ATTEMPTS) {
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
      return { retry: false };
    }

    // transient: hand the item back as dispatchable and let BullMQ's backoff own the retry
    await this.runItems.update(item.id, { state: 'queued', claimedAt: null, error: message });
    this.logger.warn(
      `Transfer retry (${run.kind}) item=${item.id} attempt=${request.attempt}: ${message}`,
    );
    return { retry: true };
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
