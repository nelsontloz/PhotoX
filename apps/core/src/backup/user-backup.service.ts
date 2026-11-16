import { Injectable } from '@nestjs/common';
import type { AdminUserBackupSync } from '@photox/shared-types';
import { User } from '../database/entities/user.entity';
import { BackupRun } from '../database/entities/backup-run.entity';
import { TRANSFER_DISPATCH_BATCH_SIZE, type TransferKind } from './backup-transfer.constants';
import { BackupStatusService } from './backup-status.service';
import { BackupPrefixService } from './backup-prefix.service';
import { BackupMergeService } from './backup-merge.service';
import { RunFinalizeService } from './run-finalize.service';
import { RunLifecycleService } from './run-lifecycle.service';
import { TransferDispatchService } from './transfer-dispatch.service';
import type {
  BackupOverviewRow,
  BackupProgress,
  BackupRunStatus,
  BackupStatus,
  DeleteBackupResult,
  MergeBackupResult,
  MergeUserBackupInput,
  TransferJobLike,
  UserBackupManifest,
} from './backup.types';

export * from './backup.types';
export {
  extOf,
  isDerivativeStorageKey,
  shouldSkipUpload,
  unionBackupManifests,
} from './backup-manifest';
export {
  buildBackupOverviewRow,
  buildOrphanBackupOverviewRow,
  buildFallbackEmail,
  snapshotFromStatus,
} from './backup-overview.builder';

/**
 * Per-user backup/restore: user-scoped rows + original bytes to S3 (Floci,
 * docker-only), same-UUID reinsert + derivative regeneration on restore.
 *
 * Backup set: users row (same UUID) + files (originals only — transcode rows are
 * dropped, videos re-transcode) + assets + albums + album_assets + shares +
 * persons. Skipped: refresh_tokens (restored clients re-login), faces/embeddings/
 * detections/thumbnails (all regenerable via re-enqueue). Trashed rows+bytes
 * travel as-is and stay degraded (reprocess filters exclude trashed).
 *
 * Restore commits rows + one ledger item per original in one transaction, then the
 * advisory-locked sweeper downloads one file per item and retries each file on its
 * own schedule; finalize re-enqueues derivatives. Backup uses the same ledger, writes
 * original bytes per item and `manifest.json` LAST (HEAD-verified), so a failed run
 * never leaves a live manifest over missing bytes. Successful items are deleted; a
 * failed/paused run is resumable by starting it again with the same manifest
 * (`startRestore`).
 * The run directory under `STORAGE_DIR/backup-runs/<runId>/` is skipped by the orphan
 * sweep and removed when a run completes.
 *
 * Stale-until-jobs-complete (A2/A3): derivative statuses restore as-was while the
 * bytes/jobs are still outstanding — transcode/thumbnail/face/embedding statuses
 * stay stale until their re-enqueued jobs complete, `metadataStatus` is reset to
 * `pending` for every asset (M2 covers videos too) and refills via metadata jobs,
 * and `persons.faceCount` stays stale until the restore cluster job assigns fresh
 * covers/counts.
 *
 * Email changes auto-rename prefixes (A6): the S3 layout is keyed by backup-time
 * email (`backups/<email>__<userId>/`), so a backup copy-forwards bytes from
 * every stale same-userId prefix into the current one (server-side copy, manifest
 * skipped and rewritten fresh), gates uploads on the previous manifest + a
 * pre-loop listKeys of the new prefix (uploaded/skipped counters), prunes the
 * new prefix before the manifest lands (M3: bytes first, manifest last, HEAD
 * verified), then deletes the old prefixes — restores still resolve by userId
 * suffix for any leftover orphans.
 *
 * Merge adoption (admin): a matched legacy snapshot merges additively, then its
 * source originals/manifest are adopted into the live account's own prefix and
 * unioned with any live manifest (live entries win); the source prefix is
 * deleted only after the ledger lands, so the live row reads as a normal
 * backed-up row. Adoption failure keeps the source and writes no ledger, so a
 * plain retry stays allowed (see mergeUserBackup).
 *
 * Floci runbook (docker-only, no host installs): `docker compose up -d floci`.
 * Host core uses `S3_ENDPOINT=http://localhost:4566`; in-Compose core uses
 * `http://floci:4566`. E2E uses the `photox-e2e-backups` bucket — dev/prod share
 * nothing. Backup writes original bytes FIRST, `manifest.json` LAST (M3), so a
 * failed run never leaves a live manifest over missing bytes; fixed keys make a
 * rerun idempotent (missing bytes re-upload, manifest lands last).
 */
@Injectable()
export class UserBackupService {
  // ponytail: the facade is a thin delegator — the seven phase services are Nest providers, so
  // the controller, dispatcher and consumers keep their single-token wiring. Upgrade to injecting
  // a phase service directly only if a caller needs just one phase.
  constructor(
    private readonly statusService: BackupStatusService,
    private readonly prefixService: BackupPrefixService,
    private readonly finalizeService: RunFinalizeService,
    private readonly dispatchService: TransferDispatchService,
    private readonly lifecycleService: RunLifecycleService,
    private readonly mergeService: BackupMergeService,
  ) {}

  startBackup(emailOrId: string): Promise<{ runId: string }> {
    return this.lifecycleService.startBackup(emailOrId);
  }

  startRestore(emailOrId: string, restoreEmail?: string): Promise<{ runId: string }> {
    return this.lifecycleService.startRestore(emailOrId, restoreEmail);
  }

  mergeUserBackup(input: MergeUserBackupInput): Promise<MergeBackupResult> {
    return this.mergeService.mergeUserBackup(input);
  }

  moveBackupPrefix(user: User): Promise<AdminUserBackupSync> {
    return this.prefixService.moveBackupPrefix(user);
  }

  deleteBackup(emailOrId: string): Promise<DeleteBackupResult> {
    return this.prefixService.deleteBackup(emailOrId);
  }

  backupStatus(emailOrId: string): Promise<BackupStatus> {
    return this.statusService.backupStatus(emailOrId);
  }

  backupOverview(): Promise<BackupOverviewRow[]> {
    return this.statusService.backupOverview();
  }

  getBackupProgress(emailOrId: string): Promise<BackupProgress> {
    return this.statusService.getBackupProgress(emailOrId);
  }

  toRunStatus(run: BackupRun): BackupRunStatus {
    return this.finalizeService.toRunStatus(run);
  }

  getRunStatus(runId: string): Promise<BackupRunStatus> {
    return this.finalizeService.getRunStatus(runId);
  }

  runTransfersOnce(ignoreBackoff = false): Promise<number> {
    return this.dispatchService.runTransfersOnce(ignoreBackoff);
  }

  dispatchPendingTransfers(
    kind: TransferKind,
    limit = TRANSFER_DISPATCH_BATCH_SIZE,
  ): Promise<number> {
    return this.dispatchService.dispatchPendingTransfers(kind, limit);
  }

  requeueStaleQueued(): Promise<void> {
    return this.dispatchService.requeueStaleQueued();
  }

  reconcileTransfers(): Promise<void> {
    return this.dispatchService.reconcileTransfers();
  }

  consumeTransferJob(kind: TransferKind, job: TransferJobLike): Promise<void> {
    return this.dispatchService.consumeTransferJob(kind, job);
  }

  finalizeBackupRun(run: BackupRun, manifest: UserBackupManifest): Promise<void> {
    return this.finalizeService.finalizeBackupRun(run, manifest);
  }

  assertNoLiveWipe(userId: string): Promise<void> {
    return this.lifecycleService.assertNoLiveWipe(userId);
  }
}
