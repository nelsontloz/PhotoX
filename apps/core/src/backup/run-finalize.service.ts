import { NotFoundException, ServiceUnavailableException, type Logger } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { In, type DataSource, type Repository } from 'typeorm';
import {
  backupPrefix,
  manifestKey,
  originalKey,
  type LocalStorageService,
} from '@photox/shared-config';
import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types';
import { errorMessage, errorName } from '../common/errors';
import { Asset, FileRecord } from '../database/entities';
import { BackupRun } from '../database/entities/backup-run.entity';
import { BackupRunItem } from '../database/entities/backup-run-item.entity';
import { backfillPlaces, type PlacesBackfillItem } from '../places/places-backfill';
import type { PlacesResolveService } from '../places/places-resolve.service';
import type { BullMqService } from '../queue/bullmq.service';
import { extOf, isDerivativeStorageKey } from './backup-manifest';
import type { BackupPrefixService } from './backup-prefix.service';
import type { BackupStorageIo } from './backup-storage-io';
import { rowsOf } from './bulk-io';
import type {
  BackupResult,
  BackupRunStatus,
  PreviousFileEntry,
  RestoreResult,
  UserBackupManifest,
} from './backup.types';
import type { S3BackupService } from './s3-backup.service';

/**
 * Final phase of a backup/restore run: promote a drained run to `finalizing`, publish the backup
 * manifest (or trash broken restores and fan out derivatives), and write the terminal row.
 * Nothing here calls the start or dispatch phase — the dependency arrow only points inward.
 */
export class RunFinalizeService {
  constructor(
    private readonly s3: S3BackupService,
    private readonly dataSource: DataSource,
    private readonly bullMq: BullMqService,
    private readonly places: PlacesResolveService,
    private readonly storage: LocalStorageService,
    private readonly files: Repository<FileRecord>,
    private readonly assets: Repository<Asset>,
    private readonly runs: Repository<BackupRun>,
    private readonly runItems: Repository<BackupRunItem>,
    private readonly prefixService: BackupPrefixService,
    private readonly storageIo: BackupStorageIo,
    private readonly logger: Logger,
  ) {}

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

  originalFiles(userId: string) {
    return this.files
      .createQueryBuilder('f')
      .where('f."userId" = :userId', { userId })
      .andWhere('f.purpose = :purpose', { purpose: 'original' })
      .andWhere('f."storageKey" LIKE :prefix', { prefix: 'originals/%' });
  }

  manifestDraftKey(runId: string): string {
    return join('backup-runs', runId, 'manifest.json');
  }

  async writeManifestDraft(runId: string, manifest: UserBackupManifest): Promise<void> {
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

  /** Runs with no claimable items left are atomically promoted to finalizing and finished. */
  async finalizeDueRuns(onlyRunId: string | null): Promise<void> {
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

  async finalizeRun(runId: string): Promise<void> {
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

  async failRun(runId: string, error: string): Promise<void> {
    await this.runs.update(runId, {
      state: 'failed',
      error,
      finishedAt: new Date(),
      currentFile: null,
      updatedAt: new Date(),
    });
  }

  async loadPreviousFileMap(
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
