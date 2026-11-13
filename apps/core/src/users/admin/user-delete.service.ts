import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  USER_DELETE_QUEUE,
  userDeleteJobId,
  type AdminUserDeleteState,
  type UserDeleteFinishRequest,
  type UserDeletePhase,
  type UserDeleteStepResult,
} from '@photox/shared-types';
import { DataSource, In, Repository } from 'typeorm';
import { Album } from '../../database/entities/album.entity';
import { Face, FileRecord, Person, UploadSession } from '../../database/entities';
import { UserDelete } from '../../database/entities/user-delete.entity';
import { BackupRun } from '../../database/entities/backup-run.entity';
import { Share } from '../../database/entities/share.entity';
import { BackupMerge } from '../../database/entities/backup-merge.entity';
import { BullMqService } from '../../queue/bullmq.service';
import { User } from '../../database/entities/user.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';

export interface UserDeleteProgress {
  jobId: string;
  state: AdminUserDeleteState;
  backupPrefix: string;
  phase: UserDeletePhase | null;
  deletedRows: number;
  deletedFiles: number;
  failedFiles: number;
  error: string | null;
}

/** Assets removed per `step` call; the batch that bounds one transaction. */
const ASSET_BATCH = 200;

/** Rows removed per `step` call for tables without an asset cascade. */
const ROW_BATCH = 2000;

/** Rows that disappear in one statement, in the order they must go. */
const ROW_PHASES = ['files', 'faces', 'persons', 'albums', 'shares', 'sessions', 'ledger'] as const;

/**
 * The account wipe, split into bounded steps that the worker's `user-delete` consumer drives
 * through `POST /worker/users/:id/purge/step`, then finishes through `.../finish`.
 *
 * Why batched: the previous single call deleted the whole library in one transaction and then
 * unlinked every byte in-request. It held locks for minutes on a large account, a crashed
 * request could not be retried, and every file error was swallowed while the run still
 * reported `completed`. Now each call is one short transaction; the worker loops, sweeps the
 * four storage prefixes by id (it owns `STORAGE_DIR`), and reports what it actually deleted.
 *
 * HARD RULE — backups excluded: per-user backups live in external S3
 * (`backups/<email>__<userId>/`, see UserBackupService/S3BackupService). This service MUST NOT
 * call S3BackupService listKeys/deleteKeys/deleteKey/copyPrefix, MUST NOT enumerate or delete
 * manifest.json or originals — the prefix stays intact and the status reports it
 * (`backupKept: true`). Only the core-side ledger rows (`backup_runs`, `backup_merges`) go.
 *
 * Session invalidation happens on the first step, not the last: refresh tokens are deleted and
 * `tokensValidAfter` is bumped before any row disappears, so an account being wiped cannot keep
 * signing in while the batches drain.
 */
@Injectable()
export class UserDeleteService {
  private readonly logger = new Logger(UserDeleteService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly bullMq: BullMqService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserDelete) private readonly runs: Repository<UserDelete>,
  ) {}

  /** Records the admin's enqueue intent and resets any counters from an earlier run. */
  async markQueued(userId: string, jobId: string, prefix: string, email?: string): Promise<void> {
    // `email` is only written when known: an upsert that omits it keeps the address a previous
    // attempt recorded, and `startedAt` (a database default, never listed here) keeps the first
    // attempt's time across retries.
    const values: Partial<UserDelete> = {
      userId,
      jobId,
      state: 'queued',
      backupPrefix: prefix,
      phase: null,
      deletedRows: 0,
      deletedFiles: 0,
      failedFiles: 0,
      error: null,
      sessionsLocked: false,
      finishedAt: null,
    };
    if (email !== undefined) values.email = email;
    await this.runs.upsert(values, ['userId']);
  }

  /**
   * The enqueue never reached BullMQ, so no worker will drive the steps. Terminal `failed`
   * keeps the intent visible; a retry request writes `queued` again (markQueued resets it).
   */
  async markEnqueueFailed(userId: string, message: string): Promise<void> {
    await this.runs.update(userId, { state: 'failed', error: message, finishedAt: new Date() });
  }

  async getProgress(userId: string): Promise<UserDeleteProgress | undefined> {
    const row = await this.runs.findOne({ where: { userId } });
    if (!row) return undefined;
    return {
      jobId: row.jobId,
      state: row.state,
      backupPrefix: row.backupPrefix,
      phase: row.phase,
      deletedRows: row.deletedRows,
      deletedFiles: row.deletedFiles,
      failedFiles: row.failedFiles,
      error: row.error,
    };
  }

  /**
   * Drop a retained terminal (completed/failed) delete job for the user. BullMQ dedups
   * by jobId, so such a job would silently swallow the next enqueue for the same id
   * (restores re-create the account with its original userId), leaving the UI polling a
   * stale `completed` while the row never dies. In-flight jobs are left alone.
   */
  async clearFinishedJob(userId: string): Promise<boolean> {
    const jobId = userDeleteJobId(userId);
    try {
      const job = await this.bullMq.getQueue(USER_DELETE_QUEUE).getJob(jobId);
      if (!job) return false;
      const state = await job.getState();
      if (state !== 'completed' && state !== 'failed') return false;
      await job.remove();
      return true;
    } catch (err) {
      this.logger.warn(
        `User-delete stale job clear failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * One bounded unit of the wipe. Stateless: every call asks "what is left" instead of carrying
   * a cursor, so a crash between calls costs nothing and a retry resumes. Idempotent — with no
   * live user row it answers `done` forever; a terminal row that still meets a live user row
   * means the reset was lost, so the wipe restarts instead of trusting the stale state.
   */
  async step(userId: string, prefix: string): Promise<UserDeleteStepResult> {
    const [run, user] = await Promise.all([
      this.runs.findOne({ where: { userId } }),
      this.users.findOne({ where: { id: userId } }),
    ]);
    if (!user) {
      // idempotent retry: a previous run already dropped the row; the caller still has to
      // sweep the bytes, so `done` here never means "finished"
      if (!run) await this.markQueued(userId, userDeleteJobId(userId), prefix);
      await this.markFilesPending(userId);
      return { done: true, phase: 'rows-done', deleted: 0 };
    }

    if (!run) {
      await this.markQueued(userId, userDeleteJobId(userId), prefix, user.email);
    } else if (run.state === 'completed' || run.state === 'partial' || run.state === 'failed') {
      // The user row is back (restore/merge rebuilt the account, or a re-delete raced the
      // queue), so the terminal row is stale: restart the wipe instead of lying `done`.
      await this.runs.update(userId, {
        state: 'active',
        phase: null,
        backupPrefix: prefix,
        deletedRows: 0,
        deletedFiles: 0,
        failedFiles: 0,
        error: null,
        sessionsLocked: false,
      });
    } else if (run.state === 'queued') {
      await this.runs.update(userId, { state: 'active' });
    }

    const locked = await this.runs.findOne({ where: { userId } });
    if (locked && !locked.sessionsLocked) {
      // sessions die first, so nothing can sign in while the rows drain
      await this.dataSource.transaction(async (m) => {
        await m.delete(RefreshToken, { userId });
        await m.update(User, userId, { tokensValidAfter: new Date() });
        await m.update(UserDelete, userId, { sessionsLocked: true });
      });
      await this.advance(userId, 'tokens', 0);
      return { done: false, phase: 'tokens', deleted: 0 };
    }

    // no ORDER BY: sorting the whole library per batch would be O(n^2) on a big account
    const assets: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM assets WHERE "userId" = $1 LIMIT $2`,
      [userId, ASSET_BATCH],
    );
    if (assets.length > 0) {
      const ids = assets.map((row) => row.id);
      await this.dataSource.transaction(async (m) => {
        // album links and faces carry no asset FK cascade; the asset delete drops
        // thumbnails/embeddings/detections (and shares by assetId)
        await m.query(`DELETE FROM album_assets WHERE "assetId" = ANY($1::uuid[])`, [ids]);
        await m.query(`DELETE FROM faces WHERE "assetId" = ANY($1::uuid[])`, [ids]);
        await m.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [ids]);
      });
      await this.advance(userId, 'assets', ids.length);
      return { done: false, phase: 'assets', deleted: ids.length };
    }

    for (const phase of ROW_PHASES) {
      const deleted = await this.runPhase(phase, userId);
      if (deleted > 0) {
        await this.advance(userId, phase, deleted);
        return { done: false, phase, deleted };
      }
    }

    const removed = await this.deleteUserRow(userId);
    if (removed) {
      await this.advance(userId, 'user', 1);
      await this.markFilesPending(userId);
      return { done: true, phase: 'user', deleted: 1 };
    }
    await this.markFilesPending(userId);
    return { done: true, phase: 'rows-done', deleted: 0 };
  }

  /**
   * Terminal report from the worker after its storage sweep. `error` means the rows half did
   * not finish; a non-zero `filesFailed` means the rows went but some bytes stayed — the honest
   * `partial` state, which a retry can fix.
   */
  async finish(userId: string, report: UserDeleteFinishRequest): Promise<void> {
    const state: AdminUserDeleteState = report.error
      ? 'failed'
      : report.filesFailed > 0
        ? 'partial'
        : 'completed';
    await this.runs.update(userId, {
      state,
      deletedFiles: report.filesDeleted,
      failedFiles: report.filesFailed,
      error: report.firstError ?? report.error ?? null,
      finishedAt: new Date(),
    });
    this.logger.log(
      `User wipe ${state}: user=${userId} rows=${(await this.getProgress(userId))?.deletedRows ?? 0} ` +
        `files=${report.filesDeleted} failed=${report.filesFailed}`,
    );
  }

  /** Rows are gone; the worker is sweeping bytes. Restores stay blocked until it reports. */
  private async markFilesPending(userId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE user_deletes SET state = 'wiping-files', "updatedAt" = now()
        WHERE "userId" = $1 AND state IN ('queued', 'active')`,
      [userId],
    );
  }

  private async advance(userId: string, phase: UserDeletePhase, rows: number): Promise<void> {
    await this.dataSource.query(
      `UPDATE user_deletes
          SET state = 'active', phase = $2, "deletedRows" = "deletedRows" + $3,
              error = NULL, "updatedAt" = now()
        WHERE "userId" = $1`,
      [userId, phase, rows],
    );
  }

  private async runPhase(phase: (typeof ROW_PHASES)[number], userId: string): Promise<number> {
    return this.dataSource.transaction(async (m) => {
      switch (phase) {
        case 'files': {
          // bounded like the asset batches: one DELETE over 100k rows would be the long
          // transaction this whole change exists to avoid
          const rows: { id: string }[] = await m.query(
            `SELECT id FROM files WHERE "userId" = $1 LIMIT $2`,
            [userId, ROW_BATCH],
          );
          if (rows.length === 0) return 0;
          await m.delete(FileRecord, { id: In(rows.map((row) => row.id)) });
          return rows.length;
        }
        case 'faces': {
          const rows: { id: string }[] = await m.query(
            `SELECT id FROM faces WHERE "userId" = $1 LIMIT $2`,
            [userId, ROW_BATCH],
          );
          if (rows.length === 0) return 0;
          await m.delete(Face, { id: In(rows.map((row) => row.id)) });
          return rows.length;
        }
        case 'persons':
          return (await m.delete(Person, { userId })).affected ?? 0;
        case 'albums': {
          const ids: { id: string }[] = await m.query(`SELECT id FROM albums WHERE "userId" = $1`, [
            userId,
          ]);
          if (ids.length > 0) {
            await m.query(`DELETE FROM album_assets WHERE "albumId" = ANY($1::uuid[])`, [
              ids.map((row) => row.id),
            ]);
          }
          return (await m.delete(Album, { userId })).affected ?? 0;
        }
        case 'shares':
          return (await m.delete(Share, { userId })).affected ?? 0;
        case 'sessions':
          // parts CASCADE from the session row
          return (await m.delete(UploadSession, { userId })).affected ?? 0;
        case 'ledger': {
          // the core-side transfer ledger is metadata about the account; the S3 backup stays
          const merges = (await m.delete(BackupMerge, { targetUserId: userId })).affected ?? 0;
          const runs = (await m.delete(BackupRun, { userId })).affected ?? 0;
          return merges + runs;
        }
      }
    });
  }

  /** Last step: the user row itself, with the last-admin re-check inside the transaction. */
  private async deleteUserRow(userId: string): Promise<boolean> {
    return this.dataSource.transaction(async (m) => {
      const user = await m.findOne(User, { where: { id: userId } });
      if (!user) return false;
      if (user.role === 'admin') {
        const adminCount = await m.count(User, { where: { role: 'admin' } });
        if (adminCount <= 1) throw new ConflictException('Cannot delete the last admin');
      }
      await m.delete(User, userId);
      return true;
    });
  }
}
