import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  type Logger,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  EntityManager,
  In,
  type DataSource,
  type DeepPartial,
  type EntityTarget,
  type ObjectLiteral,
  type QueryDeepPartialEntity,
  type Repository,
} from 'typeorm';
import {
  backupPrefix,
  manifestKey,
  normalizeEmail,
  originalKey,
  type LocalStorageService,
} from '@photox/shared-config';
import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types';
import { errorMessage, errorName } from '../common/errors';
import { isPostgresUniqueViolation } from '../common/sql-errors';
import { Album, AlbumAsset, Asset, FileRecord, Person, Share, User } from '../database/entities';
import { BackupRun } from '../database/entities/backup-run.entity';
import { BackupRunItem } from '../database/entities/backup-run-item.entity';
import type { UserDelete } from '../database/entities/user-delete.entity';
import { backfillPlaces, type PlacesBackfillItem } from '../places/places-backfill';
import type { PlacesResolveService } from '../places/places-resolve.service';
import type { BullMqService } from '../queue/bullmq.service';
import { buildFallbackEmail } from './backup-overview.builder';
import {
  albumToManifestEntry,
  assetToManifestEntry,
  extOf,
  fileToManifestEntry,
  isDerivativeStorageKey,
  personToManifestEntry,
  shareToManifestEntry,
  shouldSkipUpload,
  userToManifest,
} from './backup-manifest';
import type { BackupPrefixService } from './backup-prefix.service';
import type { BackupStatusService } from './backup-status.service';
import { sha256File, type BackupStorageIo } from './backup-storage-io';
import {
  TRANSFER_DISPATCH_BATCH_SIZE,
  TRANSFER_JOB_ATTEMPTS,
  TRANSFER_JOB_BACKOFF_MS,
  TRANSFER_QUEUE_LEASE_MS,
  TRANSFER_QUEUES,
  type TransferJobData,
  type TransferKind,
} from './backup-transfer.constants';
import type {
  BackupResult,
  BackupRunStatus,
  ClaimedBackupItem,
  PreviousFileEntry,
  RestoreResult,
  TransferJobLike,
  UserBackupManifest,
} from './backup.types';
import { isNotFound, type S3BackupService } from './s3-backup.service';

/**
 * Rows per bulk INSERT: Postgres rejects a statement with more than 65,535 bind parameters, and
 * TypeORM only splits when `chunk` is set (Asset alone binds ~47 columns per row).
 */
export const BULK_CHUNK = 500;

/** Splits a list into fixed-size groups — one statement per group stays under the bind cap. */
export function chunked<T>(items: T[], size = 1000): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/** One bulk save that always chunks; an empty input is a no-op. */
export async function bulkSave<Entity>(
  manager: EntityManager,
  entity: EntityTarget<Entity>,
  rows: DeepPartial<Entity>[],
): Promise<void> {
  await manager.save(entity, rows, { chunk: BULK_CHUNK });
}

/** One bulk insert that always chunks; an empty input issues no statement. */
export async function bulkInsert<Entity extends ObjectLiteral>(
  manager: EntityManager,
  entity: EntityTarget<Entity>,
  rows: QueryDeepPartialEntity<Entity>[],
): Promise<void> {
  for (const group of chunked(rows, BULK_CHUNK)) await manager.insert(entity, group);
}

/**
 * 23505 from `UQ_backup_runs_active_user`: the real "one active run per user" guard. Two starts
 * that race `assertNoActiveRun` (a plain read) would share one fixed S3 prefix and prune each
 * other's uploads, so the second insert is refused here instead of damaging a backup.
 */
function rethrowActiveRunConflict(err: unknown): never {
  if (isPostgresUniqueViolation(err)) {
    throw new ConflictException('A backup or restore is already running for this user');
  }
  throw err;
}

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
 * TypeORM's Postgres driver returns UPDATE/DELETE results as `[rows, affected]`; SELECTs return
 * the rows directly. Normalize both so a claim/finalize query reads the same way.
 */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return result as T[];
}

export class BackupRunService {
  constructor(
    private readonly storageIo: BackupStorageIo,
    private readonly statusService: BackupStatusService,
    private readonly prefixService: BackupPrefixService,
    private readonly s3: S3BackupService,
    private readonly dataSource: DataSource,
    private readonly bullMq: BullMqService,
    private readonly places: PlacesResolveService,
    private readonly storage: LocalStorageService,
    private readonly users: Repository<User>,
    private readonly files: Repository<FileRecord>,
    private readonly assets: Repository<Asset>,
    private readonly albums: Repository<Album>,
    private readonly albumAssets: Repository<AlbumAsset>,
    private readonly shares: Repository<Share>,
    private readonly persons: Repository<Person>,
    private readonly runs: Repository<BackupRun>,
    private readonly runItems: Repository<BackupRunItem>,
    private readonly userDeletes: Repository<UserDelete>,
    private readonly logger: Logger,
  ) {}

  /**
   * Creates a backup run: snapshot the account, write the manifest draft, then the run + one
   * item per original that is not already in S3 (the incremental gate). The sweeper uploads
   * each item and the run finalizes with the manifest LAST — a run that fails never leaves a
   * live manifest over missing bytes.
   */
  async startBackup(emailOrId: string): Promise<{ runId: string }> {
    const user = await this.statusService.findUser(emailOrId);
    if (!user) throw new NotFoundException(`No user for ${emailOrId}`);
    // a wipe that is still sweeping bytes must not snapshot (or re-snapshot) this account
    await this.assertNoLiveWipe(user.id);
    // A paused run is resumable by starting the backup again (same contract as restore): no
    // request can move it out of `paused`, and `assertNoActiveRun` below would 409 forever.
    const paused = await this.runs.findOne({
      where: { userId: user.id, kind: 'backup', state: 'paused' },
      order: { startedAt: 'DESC' },
    });
    if (paused) {
      await this.resumeRun(paused.id);
      this.logger.log(`Backup run ${paused.id} resumed for user ${user.id}`);
      return { runId: paused.id };
    }
    await this.s3.ensureBucket();
    await this.assertNoActiveRun(user.id);
    await this.cleanupAbandonedBackupRuns(user.id);

    const fileRowsPromise = this.originalFiles(user.id).getMany();
    const [fileRows, assetRows, albumRows, shareRows, personRows] = await Promise.all([
      fileRowsPromise,
      this.assets.find({ where: { userId: user.id } }),
      this.albums.find({ where: { userId: user.id } }),
      this.shares.find({ where: { userId: user.id } }),
      this.persons.find({ where: { userId: user.id } }),
    ]);
    const albumIds = albumRows.map((a) => a.id);
    const albumAssetRows =
      albumIds.length > 0
        ? await this.albumAssets
            .createQueryBuilder('aa')
            .where('aa."albumId" IN (:...ids)', { ids: albumIds })
            .getMany()
        : [];

    const backedUpAt = new Date().toISOString();
    const manifest: UserBackupManifest = {
      manifestVersion: 1,
      userId: user.id,
      emailAtBackup: user.email,
      backedUpAt,
      user: userToManifest(user),
      files: fileRows.map(fileToManifestEntry),
      assets: assetRows.map(assetToManifestEntry),
      albums: albumRows.map(albumToManifestEntry),
      albumAssets: albumAssetRows.map((aa) => ({ albumId: aa.albumId, assetId: aa.assetId })),
      shares: shareRows.map(shareToManifestEntry),
      persons: personRows.map(personToManifestEntry),
    };

    // one-backup-per-user: fixed keys, bytes first, manifest last (M3). The stale-prefix
    // rename stays in the start step — it is a rare, bounded set of server-side copies.
    const prefix = backupPrefix(user.email, user.id);
    const manifestObjectKey = manifestKey(user.email, user.id);
    const runId = randomUUID();

    let stalePrefixes: string[] = [];
    try {
      stalePrefixes = await this.prefixService.findStalePrefixesForUser(user.id, prefix);
    } catch (err) {
      this.logger.warn(
        `Stale prefix scan failed for user ${user.id} (${errorName(err)}) — skipping rename`,
      );
      stalePrefixes = [];
    }
    if (stalePrefixes.length > 0) {
      try {
        await this.prefixService.renameBackupPrefix(stalePrefixes, prefix);
      } catch (err) {
        this.logger.warn(
          `Backup rename failed for user ${user.id} (${errorMessage(err)}) — continuing with direct upload`,
        );
      }
    }
    let prevFileMap = await this.loadPreviousFileMap(manifestObjectKey);
    if (prevFileMap === null) {
      for (const stale of stalePrefixes) {
        const fallback = await this.loadPreviousFileMap(`${stale}manifest.json`);
        if (fallback !== null) {
          prevFileMap = fallback;
          break;
        }
      }
    }
    let listedSet: Set<string>;
    try {
      listedSet = new Set(await this.s3.listKeys(prefix));
    } catch (err) {
      this.logger.warn(
        `Backup listKeys failed for ${prefix} (${errorName(err)}) — uploading all, skipping prune`,
      );
      listedSet = new Set<string>();
    }

    const items: {
      runId: string;
      fileId: string;
      storageKey: string;
      s3Key: string;
      sizeBytes: number;
      checksumSha256: string;
      mimeType: string;
      state: 'pending';
      attempts: number;
      nextAttemptAt: Date;
    }[] = [];
    let skipped = 0;
    for (const file of manifest.files) {
      const key = originalKey(user.email, user.id, file.id, extOf(file.storageKey));
      if (shouldSkipUpload(prevFileMap, listedSet, file, key)) {
        skipped += 1;
        continue;
      }
      items.push({
        runId,
        fileId: file.id,
        storageKey: file.storageKey,
        s3Key: key,
        sizeBytes: file.sizeBytes,
        checksumSha256: file.checksumSha256,
        mimeType: file.mimeType,
        state: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
      });
    }

    const manifestPath = this.manifestDraftKey(runId);
    await this.writeManifestDraft(runId, manifest);

    await this.dataSource.transaction(async (manager: EntityManager) => {
      await manager
        .insert(BackupRun, {
          id: runId,
          kind: 'backup',
          userId: user.id,
          state: 'running',
          email: user.email,
          prefix,
          manifestKey: manifestObjectKey,
          manifestPath,
          identity: backedUpAt,
          stalePrefixes,
          counts: {
            files: manifest.files.length,
            assets: assetRows.length,
            albums: albumRows.length,
            shares: shareRows.length,
            persons: personRows.length,
          },
          totalItems: manifest.files.length,
          completedItems: skipped,
          uploaded: 0,
          skipped,
          failedItems: 0,
          currentFile: null,
          error: null,
          result: null,
          finishedAt: null,
        })
        .catch(rethrowActiveRunConflict);
      await bulkInsert(manager, BackupRunItem, items);
    });

    this.logger.log(
      `Backup run ${runId} started for user ${user.id} (${items.length} to upload, ${skipped} unchanged)`,
    );
    return { runId };
  }

  /**
   * Creates a restore run: validate the manifest, resolve the restored email, then commit the
   * rows, the run and one item per original in one transaction. The sweeper downloads each item
   * independently; finalize re-enqueues derivatives and re-homes the prefix if the email changed.
   *
   * An unfinished run for the SAME manifest can be resumed even though the user row is live
   * (that is how a failed restore is retried instead of 409ing forever).
   */
  async startRestore(emailOrId: string, restoreEmail?: string): Promise<{ runId: string }> {
    // checked before any S3 work: a batched delete owns the account until its last step
    const liveTarget = await this.statusService.findUser(emailOrId);
    if (liveTarget) await this.assertNoLiveWipe(liveTarget.id);
    await this.s3.ensureBucket();
    let located: { prefix: string; manifestObjectKey: string; userId: string };
    try {
      located = await this.statusService.locateBackup(emailOrId);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }
    // a wipe leaves no live user row, so the guard above cannot fire: locateBackup resolves
    // the id from the snapshot prefix, and the byte sweep must still block the restore
    await this.assertNoLiveWipe(located.userId);
    // A live user with no exact manifest resolves to its exact prefix (so callers
    // can report exists:false) — the GET then 404s instead of leaking NoSuchKey.
    // zod runtime-validates the downloaded manifest (untrusted S3 bytes)
    const read = await this.storageIo.readManifest(located.manifestObjectKey);
    if ('error' in read) {
      if (read.error === 'missing') throw new NotFoundException(`No backup found for ${emailOrId}`);
      if (read.error === 'unreadable')
        throw new ServiceUnavailableException('Backup storage (S3) unreachable');
      throw read.cause instanceof Error ? read.cause : new Error('backup manifest corrupt');
    }
    const manifest = read.manifest;
    if (manifest.userId !== located.userId) {
      throw new Error(
        `Backup manifest userId ${manifest.userId} does not match prefix user ${located.userId}`,
      );
    }

    // (a) same userId live: only an unfinished run for THIS manifest may resume; a completed
    // restore (or a live account backed up elsewhere) stays 409.
    const liveSameId = await this.users.findOne({ where: { id: located.userId } });
    if (liveSameId) {
      const resumable = await this.runs.findOne({
        where: {
          userId: located.userId,
          kind: 'restore',
          manifestKey: located.manifestObjectKey,
          identity: manifest.backedUpAt,
          state: In(['running', 'paused', 'failed', 'finalizing']),
        },
        order: { startedAt: 'DESC' },
      });
      if (!resumable) throw new ConflictException('already-restored');
      await this.resumeRun(resumable.id);
      this.logger.log(`Restore run ${resumable.id} resumed for user ${located.userId}`);
      return { runId: resumable.id };
    }

    // (b) email taken by a different live id (email reuse after delete) → restore
    // under the ORIGINAL userId with a fallback `restored-<ms>-<orig>` email. The
    // snapshot is re-homed to the fallback address's prefix below (bytes still
    // live under the backup-time email until then).
    // An explicit restoreEmail short-circuits that allocation: normalized, it must
    // be free of any live holder (409 email-taken) and becomes the restored
    // account's actual address as-is.
    let actualEmail = manifest.user.email;
    if (restoreEmail !== undefined) {
      actualEmail = normalizeEmail(restoreEmail);
      const liveHolder = await this.users.findOne({ where: { email: actualEmail } });
      if (liveHolder) throw new ConflictException('email-taken');
    } else {
      const liveByEmail = await this.users.findOne({
        where: { email: normalizeEmail(manifest.user.email) },
      });
      if (liveByEmail && liveByEmail.id !== manifest.userId) {
        actualEmail = await this.allocateFallbackEmail(manifest.user.email);
        this.logger.warn(
          `Restore email ${manifest.user.email} taken by ${liveByEmail.id} — ` +
            `restoring ${manifest.userId} as ${actualEmail}`,
        );
      }
    }

    // Legacy manifests (pre thumbnail-leak fix) embed derivatives/thumbnails/...
    // rows with purpose='original' — skip them on restore while still restoring
    // old originals; derivatives regenerate via reenqueueDerivatives below.
    const originalFiles = manifest.files.filter((f) => !isDerivativeStorageKey(f.storageKey));
    if (originalFiles.length !== manifest.files.length) {
      this.logger.warn(
        `Restore skipping ${manifest.files.length - originalFiles.length} derivative ` +
          `file(s) from legacy manifest for user ${manifest.userId}`,
      );
    }

    // Untrusted manifest: a storageKey outside this user's originals folder would let a crafted
    // backup write bytes into another account's prefix (pathFor only stops escaping STORAGE_DIR).
    const runId = randomUUID();
    const items = originalFiles.map((file) => {
      if (!file.storageKey.startsWith(`originals/${manifest.userId}/`)) {
        throw new BadRequestException(
          `Manifest storage key escapes the user prefix: ${file.storageKey}`,
        );
      }
      return {
        runId,
        fileId: file.id,
        storageKey: file.storageKey,
        s3Key: originalKey(
          manifest.emailAtBackup,
          manifest.userId,
          file.id,
          extOf(file.storageKey),
        ),
        sizeBytes: file.sizeBytes,
        checksumSha256: file.checksumSha256,
        mimeType: file.mimeType,
        state: 'pending' as const,
        attempts: 0,
        nextAttemptAt: new Date(),
      };
    });

    const manifestPath = this.manifestDraftKey(runId);
    await this.writeManifestDraft(runId, manifest);

    // rows first, in one transaction — links (assets.fileId, album_assets, shares)
    // land together so no row is ever orphan-eligible; timestamps default to now()
    // (inside the orphan grace window even before bytes arrive).
    // ponytail: save-with-explicit-PK (not upsert) — upsert's QueryDeepPartialEntity
    // rejects the jsonb metadata column while save's DeepPartial accepts it
    await this.dataSource.transaction(async (manager: EntityManager) => {
      await manager.save(
        User,
        manager.create(User, {
          id: manifest.user.id,
          email: actualEmail,
          role: manifest.user.role,
          passwordHash: manifest.user.passwordHash,
          displayName: manifest.user.displayName,
          tokensValidAfter: manifest.user.tokensValidAfter
            ? new Date(manifest.user.tokensValidAfter)
            : null,
        }),
      );
      // Bulk save keeps the manifest order in the INSERT; explicit PKs make every
      // row a plain insert (the same row content the per-row save produced).
      await bulkSave(
        manager,
        FileRecord,
        originalFiles.map((f) => ({
          id: f.id,
          userId: f.userId,
          storageKey: f.storageKey,
          originalName: f.originalName,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          checksumSha256: f.checksumSha256,
          purpose: 'original' as const,
          assetId: f.assetId,
        })),
      );
      await bulkSave(
        manager,
        Asset,
        manifest.assets.map((a) => ({
          ...a,
          trashedAt: a.trashedAt ? new Date(a.trashedAt) : null,
          takenAt: a.takenAt ? new Date(a.takenAt) : null,
          // restore transforms: re-transcode videos, refill phash via metadata jobs
          transcodeFileId: null,
          phash: null,
          metadataStatus: 'pending' as const,
          metadataExtractedAt: null,
        })),
      );
      await bulkSave(
        manager,
        Album,
        manifest.albums.map((a) => ({
          id: a.id,
          userId: a.userId,
          name: a.name,
          description: a.description,
          hiddenFromTimeline: a.hiddenFromTimeline,
        })),
      );
      await bulkSave(
        manager,
        AlbumAsset,
        manifest.albumAssets.map((aa) => ({ albumId: aa.albumId, assetId: aa.assetId })),
      );
      await bulkSave(
        manager,
        Share,
        manifest.shares.map((s) => ({
          id: s.id,
          userId: s.userId,
          kind: s.kind,
          assetId: s.assetId,
          albumId: s.albumId,
          token: s.token,
          expiresAt: s.expiresAt ? new Date(s.expiresAt) : null,
        })),
      );
      await bulkSave(
        manager,
        Person,
        manifest.persons.map((p) => ({
          id: p.id,
          userId: p.userId,
          name: p.name,
          coverFaceId: null,
          clusterLabel: p.clusterLabel,
          faceCount: p.faceCount,
        })),
      );

      await manager
        .insert(BackupRun, {
          id: runId,
          kind: 'restore',
          userId: manifest.userId,
          state: 'running',
          email: actualEmail,
          prefix: located.prefix,
          manifestKey: located.manifestObjectKey,
          manifestPath,
          identity: manifest.backedUpAt,
          stalePrefixes: [],
          counts: {
            files: originalFiles.length,
            assets: manifest.assets.length,
            albums: manifest.albums.length,
            shares: manifest.shares.length,
            persons: manifest.persons.length,
          },
          totalItems: originalFiles.length,
          completedItems: 0,
          uploaded: 0,
          skipped: 0,
          failedItems: 0,
          currentFile: null,
          error: null,
          result: null,
          finishedAt: null,
        })
        .catch(rethrowActiveRunConflict);
      await bulkInsert(manager, BackupRunItem, items);
    });

    this.logger.log(
      `Restore run ${runId} started for user ${manifest.userId} (${originalFiles.length} files)`,
    );
    return { runId };
  }

  /**
   * Allocates a unique fallback email for restore-after-email-reuse:
   * `restored-<ms>-<orig>` (normalized), retrying with `-<n>` local suffixes
   * until free. A suffix always finds a free address eventually, so the loop is
   * unbounded (the old 100-try + random-UUID escape hatch was unreachable).
   */
  private async allocateFallbackEmail(origEmail: string): Promise<string> {
    const nowMs = Date.now();
    for (let attempt = 0; ; attempt++) {
      const candidate = buildFallbackEmail(origEmail, nowMs, attempt);
      const existing = await this.users.findOne({ where: { email: candidate } });
      if (!existing) return candidate;
    }
  }

  /** Public status shape for the admin poller. */
  toRunStatus(run: BackupRun): BackupRunStatus {
    return {
      id: run.id,
      kind: run.kind,
      userId: run.userId,
      state: run.state,
      total: run.totalItems,
      completed: run.completedItems,
      uploaded: run.uploaded,
      skipped: run.skipped,
      failed: run.failedItems,
      ...(run.currentFile ? { currentFile: run.currentFile } : {}),
      ...(run.error ? { error: run.error } : {}),
      startedAt: run.startedAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      ...(run.finishedAt ? { finishedAt: run.finishedAt.toISOString() } : {}),
      ...(run.result ? { result: run.result as unknown as BackupResult | RestoreResult } : {}),
    };
  }

  async getRunStatus(runId: string): Promise<BackupRunStatus> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Backup run not found');
    return this.toRunStatus(run);
  }

  /**
   * One sweeper pass without BullMQ: requeue crashed claims, drive one batch of each kind
   * through the same consumer, then finish runs with nothing left. Test-only driver — the
   * production executor is the queue pair (dispatcher + consumers).
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
    await this.finalizeDueRuns(null);
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
    await this.finalizeDueRuns(null);
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

  private async handleQueueTransferError(
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
      await this.finalizeRun(runId);
    } catch (err) {
      const message = errorMessage(err);
      this.logger.error(`Backup run ${runId} finalize failed: ${message}`);
      await this.failRun(runId, `Finalize failed: ${message}`);
    }
  }

  /** The actual byte movement shared by the synchronous driver and the queue consumer. */
  private async performTransfer(run: BackupRun, item: ClaimedBackupItem): Promise<void> {
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

  /** Refuses a backup/restore/merge while a batched account wipe owns the account. */
  async assertNoLiveWipe(userId: string): Promise<void> {
    const wipe = await this.userDeletes.findOne({ where: { userId } });
    // every non-terminal state owns the account: `wiping-files` still sweeps STORAGE_DIR
    if (wipe && wipe.state !== 'completed' && wipe.state !== 'partial' && wipe.state !== 'failed') {
      throw new ConflictException(
        'A deletion is in progress for this account — wait for it to finish',
      );
    }
  }

  /**
   * The user's original files. `purpose='original'` alone also matches thumbnail rows (they share
   * the enum value but live under `derivatives/thumbnails/...`), so the storageKey prefix is the
   * second arbiter — keep both predicates, no register/storage layout change.
   */
  private originalFiles(userId: string) {
    return this.files
      .createQueryBuilder('f')
      .where('f."userId" = :userId', { userId })
      .andWhere('f.purpose = :purpose', { purpose: 'original' })
      .andWhere('f."storageKey" LIKE :prefix', { prefix: 'originals/%' });
  }

  async assertNoActiveRun(userId: string): Promise<void> {
    const active = await this.runs.findOne({
      where: { userId, state: In(['running', 'paused', 'finalizing']) },
    });
    if (active) {
      throw new ConflictException('A backup or restore is already running for this user');
    }
  }

  /** A fresh backup supersedes its own failed/cancelled attempts: drop those rows and drafts. */
  private async cleanupAbandonedBackupRuns(userId: string): Promise<void> {
    const abandoned = await this.runs.find({
      where: { userId, kind: 'backup', state: In(['failed', 'cancelled']) },
    });
    if (abandoned.length === 0) return;
    for (const run of abandoned) {
      await rm(this.storage.pathFor(join('backup-runs', run.id)), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }
    await this.runs.delete({ id: In(abandoned.map((run) => run.id)) });
  }

  private async resumeRun(runId: string): Promise<void> {
    await this.runItems.update(
      {
        runId,
        state: In(['pending', 'retrying', 'queued', 'running', 'failed', 'missing']),
      },
      { state: 'pending', attempts: 0, nextAttemptAt: new Date(), claimedAt: null, error: null },
    );
    // a retry can race a newer run for the same user (failed A, started B, then retry A): the
    // unique index turns that into a 409 instead of a raw 23505
    // The items just went back to pending, so the old failure tally is stale and `uploaded` is the
    // only durable success count (successful item rows are deleted). Without this a resumed run
    // finishes above 100% with failures it already retried. `skipped` never had item rows, so it
    // has to be added back or a resumed incremental run tops out short of 100%.
    const run = await this.runs.findOne({ where: { id: runId } });
    await this.runs
      .update(runId, {
        state: 'running',
        error: null,
        currentFile: null,
        finishedAt: null,
        failedItems: 0,
        completedItems: (run?.uploaded ?? 0) + (run?.skipped ?? 0),
        updatedAt: new Date(),
      })
      .catch(rethrowActiveRunConflict);
  }

  private manifestDraftKey(runId: string): string {
    return join('backup-runs', runId, 'manifest.json');
  }

  private async writeManifestDraft(runId: string, manifest: UserBackupManifest): Promise<void> {
    const dir = this.storage.pathFor(join('backup-runs', runId));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  }

  private async readManifestDraft(run: BackupRun): Promise<UserBackupManifest> {
    if (!run.manifestPath) throw new Error('Backup run has no manifest draft');
    return JSON.parse(
      await readFile(this.storage.pathFor(run.manifestPath), 'utf8'),
    ) as UserBackupManifest;
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

  private async restoreFile(run: BackupRun, item: ClaimedBackupItem): Promise<void> {
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

  /** Runs with no claimable items left are atomically promoted to finalizing and finished. */
  private async finalizeDueRuns(onlyRunId: string | null): Promise<void> {
    const rows = rowsOf<{ id: string }>(
      await this.dataSource.query(
        `SELECT r."id" FROM "backup_runs" r
       WHERE r."state" = 'running'
         AND NOT EXISTS (
           SELECT 1 FROM "backup_run_items" i
           WHERE i."runId" = r."id"
             AND i."state" IN ('pending', 'retrying', 'queued', 'running')
         )
         AND ($1::uuid IS NULL OR r."id" = $1::uuid)`,
        [onlyRunId],
      ),
    );
    for (const row of rows) {
      const claimed = rowsOf<{ id: string }>(
        await this.dataSource.query(
          `UPDATE "backup_runs" SET "state" = 'finalizing', "updatedAt" = now()
           WHERE "id" = $1 AND "state" = 'running' RETURNING "id"`,
          [row.id],
        ),
      );
      if (claimed.length === 0) continue;
      try {
        await this.finalizeRun(row.id);
      } catch (err) {
        const message = errorMessage(err);
        this.logger.error(`Backup run ${row.id} finalize failed: ${message}`);
        await this.failRun(row.id, `Finalize failed: ${message}`);
      }
    }
  }

  private async finalizeRun(runId: string): Promise<void> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) return;
    const manifest = await this.readManifestDraft(run);
    if (run.kind === 'backup') {
      await this.finalizeBackupRun(run, manifest);
    } else {
      await this.finalizeRestoreRun(run, manifest);
    }
  }

  async finalizeBackupRun(run: BackupRun, manifest: UserBackupManifest): Promise<void> {
    const failed = await this.runItems.count({ where: { runId: run.id, state: 'failed' } });
    if (failed > 0) {
      const first = await this.runItems.findOne({
        where: { runId: run.id, state: 'failed' },
        order: { createdAt: 'ASC' },
      });
      await this.failRun(
        run.id,
        `${failed} file(s) could not be uploaded${first?.error ? ` — ${first.error}` : ''}`,
      );
      return;
    }
    if (!run.prefix || !run.manifestKey || !run.email || !run.identity) {
      await this.failRun(run.id, 'Backup run is missing its S3 target');
      return;
    }

    // bytes are all in S3 now: the manifest lands last and is HEAD-verified
    await this.s3.putObject(
      run.manifestKey,
      Buffer.from(JSON.stringify(manifest)),
      'application/json',
    );
    await this.s3.headObject(run.manifestKey);

    // prune stale originals under the prefix (pre-fix backups uploaded thumbnail bytes) — only
    // after the replacement manifest is HEAD-verified (until then the previous manifest is the
    // published one), and keyed on the CURRENT rows rather than this run's snapshot: a file
    // created while this run was copying keeps its bytes, because a concurrent run may have
    // uploaded them and deleting them would leave a manifest listing files that do not exist
    try {
      const listed = new Set(await this.s3.listKeys(run.prefix));
      const live = await this.originalFiles(run.userId).getMany();
      const expected = new Set(
        live.map((file) => originalKey(run.email!, run.userId, file.id, extOf(file.storageKey))),
      );
      const stale = [...listed].filter(
        (key) => key.startsWith(`${run.prefix}originals/`) && !expected.has(key),
      );
      if (stale.length > 0) {
        await this.s3.deleteKeys(stale);
        this.logger.log(`Pruned ${stale.length} stale original(s) from backup for ${run.userId}`);
      }
    } catch (err) {
      this.logger.warn(
        `Backup prune listing failed for ${run.prefix} (${errorName(err)}) — skipping prune`,
      );
    }

    await this.prefixService.deletePrefixesQuietly(run.stalePrefixes ?? [], run.userId);

    const result: BackupResult = {
      userId: run.userId,
      email: run.email,
      prefix: run.prefix,
      backedUpAt: run.identity,
      files: run.counts.files ?? 0,
      assets: run.counts.assets ?? 0,
      albums: run.counts.albums ?? 0,
      shares: run.counts.shares ?? 0,
      persons: run.counts.persons ?? 0,
      uploaded: run.uploaded,
      skipped: run.skipped,
    };
    await this.completeRun(run.id, result);
    await rm(this.storage.pathFor(join('backup-runs', run.id)), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    this.logger.log(
      `Backed up user ${run.userId} (${result.files} files, ${result.uploaded} uploaded, ` +
        `${result.skipped} skipped) to ${result.prefix}`,
    );
  }

  private async finalizeRestoreRun(run: BackupRun, manifest: UserBackupManifest): Promise<void> {
    // files the backup no longer has: trash the assets BEFORE re-enqueueing derivatives so no
    // job is queued for an asset whose bytes never landed
    const broken = await this.runItems.find({
      where: { runId: run.id, state: In(['failed', 'missing']) },
    });
    const brokenFileIds = broken.map((item) => item.fileId);
    const brokenSet = new Set(brokenFileIds);
    const manifestTrashed = new Map(manifest.assets.map((a) => [a.fileId, a.isTrashed]));
    // a previous attempt trashed these; the bytes are here now and the manifest says live
    const recovered = (run.brokenFileIds ?? []).filter(
      (fileId) => !brokenSet.has(fileId) && manifestTrashed.get(fileId) === false,
    );
    if (recovered.length > 0) {
      await this.assets.update(
        { userId: run.userId, fileId: In(recovered) },
        { isTrashed: false, trashedAt: null },
      );
    }
    if (broken.length > 0) {
      await this.assets.update(
        { userId: run.userId, fileId: In(brokenFileIds) },
        { isTrashed: true, trashedAt: new Date() },
      );
      this.logger.warn(
        `${broken.length} restored file(s) missing from the backup — assets trashed for ${run.userId}`,
      );
    }
    await this.runs.update(run.id, { brokenFileIds, updatedAt: new Date() });

    const enqueued = await this.reenqueueDerivatives(run.userId);

    // Restoring under a different email re-homes the snapshot to the restored address's
    // canonical prefix now — otherwise bytes/manifest stay under the backup-time email until the
    // next backup renames them. Phase 1 (copy + manifest rewrite, manifest LAST): a failure keeps
    // the snapshot at the source prefix, reports reassignmentError and never fails the restore.
    let finalPrefix = run.prefix ?? '';
    let reassignmentError: string | undefined;
    const actualEmail = run.email ?? manifest.emailAtBackup;
    const targetPrefix = backupPrefix(actualEmail, run.userId);
    if (finalPrefix !== '' && targetPrefix !== finalPrefix) {
      const targetManifestKey = manifestKey(actualEmail, run.userId);
      try {
        await this.prefixService.renameBackupPrefix([finalPrefix], targetPrefix);
        // same snapshot, same rows/backedUpAt — only the email fields move
        const rehomed: UserBackupManifest = {
          ...manifest,
          emailAtBackup: actualEmail,
          user: { ...manifest.user, email: actualEmail },
        };
        await this.s3.putObject(
          targetManifestKey,
          Buffer.from(JSON.stringify(rehomed)),
          'application/json',
        );
        await this.s3.headObject(targetManifestKey);
        finalPrefix = targetPrefix;
      } catch (err) {
        reassignmentError = errorMessage(err);
        this.logger.warn(
          `Backup reassignment for restored user ${run.userId} -> ${targetPrefix} failed ` +
            `(${reassignmentError}) — keeping ${run.prefix}`,
        );
      }
      if (reassignmentError === undefined) {
        await this.prefixService.deletePrefixesQuietly([run.prefix ?? ''], run.userId);
      }
    }

    const completedAt = new Date().toISOString();
    const result: RestoreResult = {
      userId: run.userId,
      email: actualEmail,
      prefix: finalPrefix,
      backedUpAt: run.identity ?? manifest.backedUpAt,
      restoredFrom: {
        emailAtBackup: manifest.emailAtBackup,
        prefix: run.prefix ?? '',
        manifestObjectKey: run.manifestKey ?? '',
      },
      startedAt: run.startedAt.toISOString(),
      completedAt,
      files: run.counts.files ?? 0,
      assets: run.counts.assets ?? 0,
      albums: run.counts.albums ?? 0,
      shares: run.counts.shares ?? 0,
      persons: run.counts.persons ?? 0,
      // restore downloads bytes (no incremental S3 gate) — zero counters keep the
      // BackupResult extension satisfied without implying skipped uploads
      uploaded: 0,
      skipped: 0,
      enqueued,
      ...(reassignmentError === undefined ? {} : { reassignmentError }),
    };

    if (broken.length > 0) {
      await this.runs.update(run.id, {
        state: 'failed',
        result: result as never,
        error: `${broken.length} file(s) could not be restored`,
        finishedAt: new Date(),
        currentFile: null,
        updatedAt: new Date(),
      });
      return;
    }
    await this.completeRun(run.id, result);
    await rm(this.storage.pathFor(join('backup-runs', run.id)), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    this.logger.log(
      `Restored user ${run.userId} (${result.files} files) startedAt=${result.startedAt} ` +
        `completedAt=${completedAt} prefix=${finalPrefix}` +
        (reassignmentError !== undefined ? ` reassignmentError=${reassignmentError}` : ''),
    );
  }

  private async completeRun(runId: string, result: BackupResult | RestoreResult): Promise<void> {
    await this.runs.update(runId, {
      state: 'completed',
      result: result as never,
      error: null,
      finishedAt: new Date(),
      currentFile: null,
      updatedAt: new Date(),
    });
  }

  private async failRun(runId: string, error: string): Promise<void> {
    await this.runs.update(runId, {
      state: 'failed',
      error,
      finishedAt: new Date(),
      currentFile: null,
      updatedAt: new Date(),
    });
  }

  /**
   * Loads the previous backup's file map for the incremental gate: fetches the
   * manifest bytes, parses JSON, validates with the manifest schema, and indexes
   * original-only entries by file id. Returns null (never throws) on a missing
   * manifest (first backup), unreadable bytes, or corrupt JSON/schema — callers
   * fall back to a full upload.
   */
  private async loadPreviousFileMap(
    manifestObjectKey: string,
  ): Promise<Map<string, PreviousFileEntry> | null> {
    const read = await this.storageIo.readManifest(manifestObjectKey);
    if ('error' in read) {
      if (read.error === 'missing') {
        this.logger.log(`No previous backup manifest at ${manifestObjectKey} — full upload`);
      } else {
        this.logger.warn(
          `Previous backup manifest at ${manifestObjectKey} ${read.error} (${errorName(read.cause)}) — full upload`,
        );
      }
      return null;
    }
    const map = new Map<string, PreviousFileEntry>();
    for (const f of read.manifest.files) {
      if (isDerivativeStorageKey(f.storageKey)) continue;
      map.set(f.id, { checksumSha256: f.checksumSha256, sizeBytes: f.sizeBytes });
    }
    return map;
  }

  /**
   * Derivative regeneration after restore/merge, in pipeline order: metadata first
   * for both kinds (every restored/merged asset is `pending`; mirrors the upload
   * path which enqueues process-metadata for photos and videos alike), thumbnails
   * photo+video, per-asset video loop (no admin bulk exists), faces re-embed,
   * embeddings/detect, cluster, then places backfill. Runs twice:
   * offset-paged readers assume a stable set, so a second pass catches anything
   * the first missed under concurrent writes (jobIds dedupe, making it idempotent).
   * Existing reprocess filters are reused untouched.
   *
   * `assetFilter` limits the pass to freshly inserted rows (merge must not churn
   * the account for assets it deduped or skipped). `mode` switches the jobId
   * family so a merge never collides with a restore's in-flight job ids.
   *
   * Every add is awaited and one refused add throws 503 — the caller fails the
   * run (restore) or the request (merge) instead of reporting jobs that do not
   * exist; a retry re-runs this under a fresh run tag.
   *
   * Every jobId carries a per-run tag: BullMQ silently rejects any add whose jobId
   * already exists, and a delayed or active job holds its id until it runs. Without
   * the tag, a later restore of the same user (delete → restore again) could enqueue
   * nothing while still reporting success. Completed jobs are removed now
   * (`removeOnComplete` defaults to true), so only that in-flight window remains —
   * still enough to dedupe a re-enqueue away. Both passes of one run share the tag,
   * so their double-enqueue keeps deduping.
   */
  async reenqueueDerivatives(
    userId: string,
    assetFilter?: Set<string>,
    mode: 'restore' | 'merge' = 'restore',
  ): Promise<RestoreResult['enqueued']> {
    const totals = { metadata: 0, thumbnails: 0, videos: 0, faces: 0, ai: 0 };
    const runTag = Date.now();
    for (let pass = 0; pass < 2; pass++) {
      const assets = await this.assets.find({ where: { userId } });
      const live = assets.filter(
        (a) => !a.isTrashed && (assetFilter === undefined || assetFilter.has(a.id)),
      );
      for (const asset of live) {
        // M2: metadata for BOTH kinds — restore marks every asset pending and the
        // upload path enqueues process-metadata for photos and videos alike; the
        // photo-only admin backstop stays untouched.
        const adds: Promise<boolean>[] = [
          this.bullMq.enqueue(
            'process-metadata',
            'process-metadata',
            { assetId: asset.id, fileId: asset.fileId, userId, kind: asset.kind },
            {
              jobId: `metadata-${mode}-${runTag}-${asset.id}`,
              removeOnComplete: true,
            },
          ),
          this.bullMq.enqueueThumbnails(asset.id, asset.fileId, userId, `thumb-${mode}-${runTag}`),
        ];
        if (asset.kind === 'video') {
          adds.push(
            this.bullMq.enqueueVideo(asset.id, asset.fileId, userId, {
              jobId: `video-${mode}-${runTag}-${asset.id}`,
            }),
          );
        }
        if (asset.kind === 'photo') {
          adds.push(
            this.bullMq.enqueue(
              'process-faces',
              'process-faces',
              { assetId: asset.id, fileId: asset.fileId, userId, reason: mode },
              { jobId: `face-${mode}-${runTag}-${asset.id}` },
            ),
            this.bullMq.enqueue(
              'process-embeddings',
              'process-embeddings',
              { assetId: asset.id, fileId: asset.fileId, userId, reason: mode },
              { jobId: `embed-${mode}-${runTag}-${asset.id}-${SEARCH_EMBEDDING_MODEL}` },
            ),
            this.bullMq.enqueue(
              'process-detect',
              'process-detect',
              { assetId: asset.id, fileId: asset.fileId, userId, reason: mode },
              { jobId: `detect-${mode}-${runTag}-${asset.id}` },
            ),
          );
        }
        // P0-3 precedent (`enqueueAssetJobs`): a refused add fails the run instead of
        // reporting `completed` — the assets are already restored, so a green run with no
        // jobs leaves thumbnails/search/faces pending forever (nothing sweeps `pending`).
        if ((await Promise.all(adds)).includes(false)) {
          throw new ServiceUnavailableException('Failed to enqueue background processing jobs');
        }
        totals.metadata += pass === 0 ? 1 : 0;
        totals.thumbnails += pass === 0 ? 4 : 0;
        if (asset.kind === 'video') totals.videos += pass === 0 ? 1 : 0;
        if (asset.kind === 'photo') {
          totals.faces += pass === 0 ? 1 : 0;
          totals.ai += pass === 0 ? 2 : 0;
        }
      }
    }
    const clustered = await this.bullMq.enqueue(
      'process-faces-cluster',
      'cluster',
      { userId, reason: mode },
      { jobId: `cluster-${userId}-${mode}-${Date.now()}` },
    );
    if (!clustered) {
      throw new ServiceUnavailableException('Failed to enqueue background processing jobs');
    }
    await this.backfillUserPlaces(userId);
    return totals;
  }

  /** Per-user places backfill (shared keyset loop, scoped to userId). */
  private async backfillUserPlaces(userId: string): Promise<void> {
    const readPage = async (afterId: string | null): Promise<PlacesBackfillItem[]> => {
      const qb = this.assets
        .createQueryBuilder('a')
        .select(['a.id AS id', 'a.latitude AS latitude', 'a.longitude AS longitude'])
        .where('a."userId" = :userId', { userId })
        .andWhere('a.latitude IS NOT NULL')
        .andWhere('a.longitude IS NOT NULL')
        .andWhere('a."placeCity" IS NULL')
        .orderBy('a.id', 'ASC')
        .limit(500);
      if (afterId !== null) qb.andWhere('a.id > :afterId', { afterId });
      return qb.getRawMany<PlacesBackfillItem>();
    };
    await backfillPlaces({
      readPage,
      resolve: (latitude, longitude) => this.places.resolve(latitude, longitude),
      apply: (assetId, place) => this.assets.update(assetId, place),
      warn: (message) => this.logger.warn(message),
    });
  }
}
