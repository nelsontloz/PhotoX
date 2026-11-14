import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  type Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import { join } from 'path';
import { EntityManager, In, type DataSource, type Repository } from 'typeorm';
import {
  backupPrefix,
  manifestKey,
  normalizeEmail,
  originalKey,
  type LocalStorageService,
} from '@photox/shared-config';
import { errorMessage, errorName } from '../common/errors';
import { isPostgresUniqueViolation } from '../common/sql-errors';
import { Album, AlbumAsset, Asset, FileRecord, Person, Share, User } from '../database/entities';
import { BackupRun } from '../database/entities/backup-run.entity';
import { BackupRunItem } from '../database/entities/backup-run-item.entity';
import type { UserDelete } from '../database/entities/user-delete.entity';
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
import type { BackupStorageIo } from './backup-storage-io';
import { bulkInsert, bulkSave } from './bulk-io';
import type { RunFinalizeService } from './run-finalize.service';
import type { S3BackupService } from './s3-backup.service';
import type { UserBackupManifest } from './backup.types';

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

/**
 * First phase of a run: the account-level guards (live wipe, one active run), the snapshot and
 * ledger insert that start a backup or restore, and resume of a paused/failed run. It may read
 * the finalize phase's draft/manifest helpers; nothing calls back into this file.
 */
export class RunLifecycleService {
  constructor(
    private readonly finalize: RunFinalizeService,
    private readonly statusService: BackupStatusService,
    private readonly prefixService: BackupPrefixService,
    private readonly s3: S3BackupService,
    private readonly dataSource: DataSource,
    private readonly storage: LocalStorageService,
    private readonly storageIo: BackupStorageIo,
    private readonly users: Repository<User>,
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

    const fileRowsPromise = this.finalize.originalFiles(user.id).getMany();
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
    let prevFileMap = await this.finalize.loadPreviousFileMap(manifestObjectKey);
    if (prevFileMap === null) {
      for (const stale of stalePrefixes) {
        const fallback = await this.finalize.loadPreviousFileMap(`${stale}manifest.json`);
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

    const manifestPath = this.finalize.manifestDraftKey(runId);
    await this.finalize.writeManifestDraft(runId, manifest);

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

    const manifestPath = this.finalize.manifestDraftKey(runId);
    await this.finalize.writeManifestDraft(runId, manifest);

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

  private async allocateFallbackEmail(origEmail: string): Promise<string> {
    const nowMs = Date.now();
    for (let attempt = 0; ; attempt++) {
      const candidate = buildFallbackEmail(origEmail, nowMs, attempt);
      const existing = await this.users.findOne({ where: { email: candidate } });
      if (!existing) return candidate;
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
}
