import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  type Logger,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { In, type DataSource, type EntityManager, type Repository } from 'typeorm';
import {
  backupPrefix,
  loadEnv,
  manifestKey,
  normalizeEmail,
  originalKey,
  parseBackupDir,
  resolveBackupPrefix,
  type LocalStorageService,
} from '@photox/shared-config';
import { Album, AlbumAsset, Asset, FileRecord, Person, Share, User } from '../database/entities';
import type { BackupMerge } from '../database/entities/backup-merge.entity';
import {
  albumToManifestEntry,
  assetToManifestEntry,
  extOf,
  fileToManifestEntry,
  isDerivativeStorageKey,
  personToManifestEntry,
  shareToManifestEntry,
  unionBackupManifests,
  userToManifest,
} from './backup-manifest';
import { pickNewest, type BackupDirLocation } from './backup-overview.builder';
import { bulkSave, chunked } from './bulk-io';
import type { BackupStatusService } from './backup-status.service';
import type { BackupStorageIo } from './backup-storage-io';
import type { RunFinalizeService } from './run-finalize.service';
import type { RunLifecycleService } from './run-lifecycle.service';
import type {
  BackupStatus,
  MergeBackupResult,
  MergeUserBackupInput,
  UserBackupManifest,
} from './backup.types';
import type { S3BackupService } from './s3-backup.service';

/** `In(...)` lookups over a manifest-sized id list: one query per chunk. */
async function findInChunks<T>(ids: string[], find: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (const group of chunked(ids)) rows.push(...(await find(group)));
  return rows;
}

export class BackupMergeService {
  // In-process merge mutual exclusion (`<backupUserId>:<targetUserId>`). The unique
  // ledger pair is the durable arbiter; this only turns a concurrent double-click
  // into a clean 409 before any bytes/rows are written.
  private readonly mergesInFlight = new Set<string>();

  constructor(
    private readonly lifecycle: RunLifecycleService,
    private readonly finalize: RunFinalizeService,
    private readonly statusService: BackupStatusService,
    private readonly storageIo: BackupStorageIo,
    private readonly s3: S3BackupService,
    private readonly dataSource: DataSource,
    private readonly storage: LocalStorageService,
    private readonly users: Repository<User>,
    private readonly files: Repository<FileRecord>,
    private readonly assets: Repository<Asset>,
    private readonly albums: Repository<Album>,
    private readonly albumAssets: Repository<AlbumAsset>,
    private readonly shares: Repository<Share>,
    private readonly persons: Repository<Person>,
    private readonly backupMerges: Repository<BackupMerge>,
    private readonly logger: Logger,
  ) {}

  /**
   * Merges a matched legacy snapshot into a live account (additive only).
   *
   * Target is fixed: only the live account whose normalized email equals the
   * manifest's `emailAtBackup` may absorb the snapshot — profile fields, the
   * live prefix and sessions are never touched. Original bytes are deduped by
   * checksum (the old asset is skipped and remapped to the live asset so album
   * links/shares follow the bytes), old UUIDs are preserved for everything else,
   * and trashed assets travel as trashed.
   *
   * Rows land first in one transaction, bytes second (same cleanup-orphans
   * contract as restore), jobs third. Adoption runs next and before the ledger:
   * the merged rows are projected into a source-style manifest, unioned with any
   * existing live manifest (live entries win, shares dedupe by token), missing
   * originals are server-side copied into the live prefix, and the union manifest
   * is written last (HEAD-verified). Only the located source prefix is then
   * deleted — other prefixes of that account id survive — so the account reads
   * as a normal backed-up row instead of a legacyBackups sub-row. The source
   * account must already be deleted: a live `backupUserId` is a 409, since
   * merging it would move and then erase that account's backup.
   * The durable ledger row makes a plain rerun a 409; `force` re-plans and
   * upserts the ledger for recovery after a partial run (already-inserted ids are
   * skipped naturally). If adoption fails (unreadable live manifest or S3 error)
   * rows/bytes stay, the ledger and source delete are skipped and the result
   * carries `assigned: null` + `adoptionError`, so a plain retry stays allowed.
   */
  async mergeUserBackup(input: MergeUserBackupInput): Promise<MergeBackupResult> {
    const startedAt = new Date().toISOString();
    this.logger.warn(
      `Backup merge started at ${startedAt} — keep cleanup-orphans paused until merge ` +
        'completes; never run cleanup mid-merge (bytes land after rows, strays would be deleted)',
    );
    await this.storageIo.ensureStorage();
    const target = await this.statusService.findUser(input.targetEmailOrId);
    if (!target) throw new NotFoundException(`No user for ${input.targetEmailOrId}`);
    if (!isUUID(input.backupUserId)) {
      throw new BadRequestException('backupUserId must be a UUID');
    }
    const backupUserId = input.backupUserId;
    if (backupUserId === target.id) throw new ConflictException('already-restored');
    // neither side may be mid-wipe: the target would lose the merged rows, the source prefix
    // would be deleted by a sweep that is still running. Checked before the live-source rule
    // so a wiping account gets the specific "deletion is in progress" answer.
    await this.lifecycle.assertNoLiveWipe(backupUserId);
    await this.lifecycle.assertNoLiveWipe(target.id);
    // A merge consumes a *deleted* account's snapshot. Handing a live account's
    // backup to the target and then deleting the source would strip that account
    // of its only copy, so refuse: the admin can delete the account first.
    if (await this.users.exists({ where: { id: backupUserId } })) {
      throw new ConflictException('source-alive');
    }
    // The ledger check runs before source resolution: a successful merge adopts
    // (and deletes) the source prefix, so a repeat plain merge must still answer
    // 409 already-merged instead of 404 missing backup. Force keeps resolving the
    // source — after adoption that is a 404, which is the expected recovery limit.
    const prior = await this.backupMerges.findOne({
      where: { backupUserId, targetUserId: target.id },
    });
    if (prior && input.force !== true) throw new ConflictException('already-merged');

    const base = resolveBackupPrefix();
    let prefix: string;
    if (input.prefix !== undefined) {
      const normalized = input.prefix.endsWith('/') ? input.prefix : `${input.prefix}/`;
      if (!normalized.startsWith(base)) {
        throw new BadRequestException('prefix is outside the backup root');
      }
      let parsed: { email: string; userId: string };
      try {
        parsed = parseBackupDir(normalized.slice(base.length));
      } catch {
        throw new BadRequestException('prefix is not a backup directory');
      }
      if (parsed.userId !== backupUserId) {
        throw new BadRequestException('prefix does not belong to backupUserId');
      }
      // Round-trip the prefix through the canonical builder: this rejects path
      // separators, non-canonical encoding and anything outside a single dir.
      if (backupPrefix(parsed.email, parsed.userId) !== normalized) {
        throw new BadRequestException('prefix is not a backup directory');
      }
      prefix = normalized;
    } else {
      let found: { dir: BackupDirLocation; status: BackupStatus }[];
      try {
        found = await this.statusService.locateBackupByUserId(backupUserId);
      } catch {
        throw new ServiceUnavailableException('Backup storage (S3) unreachable');
      }
      const candidates = found.filter((candidate) => candidate.status.exists);
      if (candidates.length === 0) {
        throw new NotFoundException(`No backup found for user ${backupUserId}`);
      }
      prefix = pickNewest(
        candidates.map((candidate) => ({
          prefix: candidate.dir.prefix,
          backedUpAt: candidate.status.backedUpAt,
        })),
      ).prefix;
    }

    const read = await this.storageIo.readManifest(`${prefix}manifest.json`);
    if ('error' in read) {
      if (read.error === 'missing') throw new NotFoundException(`No backup found at ${prefix}`);
      if (read.error === 'unreadable')
        throw new ServiceUnavailableException('Backup storage (S3) unreachable');
      // never log the payload — the manifest carries the user's passwordHash
      throw new UnprocessableEntityException('backup manifest corrupt');
    }
    const manifest = read.manifest;
    if (manifest.userId !== backupUserId) {
      throw new ConflictException('backup-user-mismatch');
    }
    if (normalizeEmail(manifest.emailAtBackup) !== normalizeEmail(target.email)) {
      throw new ConflictException('email-mismatch');
    }

    const guardKey = `${backupUserId}:${target.id}`;
    if (this.mergesInFlight.has(guardKey)) throw new ConflictException('merge-in-progress');
    this.mergesInFlight.add(guardKey);
    try {
      const originalFiles = manifest.files.filter((f) => !isDerivativeStorageKey(f.storageKey));
      if (originalFiles.length !== manifest.files.length) {
        this.logger.warn(
          `Merge skipping ${manifest.files.length - originalFiles.length} derivative file(s) ` +
            `from legacy manifest for user ${backupUserId}`,
        );
      }
      const manifestFileById = new Map(originalFiles.map((file) => [file.id, file]));
      const sourceKeyFor = (file: { id: string; storageKey: string }): string =>
        originalKey(manifest.emailAtBackup, manifest.userId, file.id, extOf(file.storageKey));

      const manifestFileIds = originalFiles.map((f) => f.id);
      const manifestAssetIds = manifest.assets.map((a) => a.id);
      const manifestAlbumIds = manifest.albums.map((a) => a.id);
      const manifestPersonIds = manifest.persons.map((p) => p.id);
      const manifestShareIds = manifest.shares.map((s) => s.id);
      const manifestTokens = manifest.shares.map((s) => s.token);
      const [targetFiles, targetAssets, targetAlbums, targetShares] = await Promise.all([
        this.files.find({ where: { userId: target.id } }),
        this.assets.find({ where: { userId: target.id } }),
        this.albums.find({ where: { userId: target.id } }),
        this.shares.find({ where: { userId: target.id } }),
      ]);
      const targetAlbumIds = targetAlbums.map((album) => album.id);
      const targetAlbumAssets =
        targetAlbumIds.length > 0
          ? await this.albumAssets
              .createQueryBuilder('aa')
              .where('aa."albumId" IN (:...ids)', { ids: targetAlbumIds })
              .getMany()
          : [];
      // Existing ids are checked globally: an old UUID owned by somebody else is
      // a hard 409, never a silent overwrite or cross-account link. Each lookup is
      // split: a whole manifest would blow the bind-parameter ceiling.
      const [globalFiles, globalAssets, globalAlbums, globalPersons, globalShares, tokensInUse] =
        await Promise.all([
          findInChunks(manifestFileIds, (ids) => this.files.find({ where: { id: In(ids) } })),
          findInChunks(manifestAssetIds, (ids) => this.assets.find({ where: { id: In(ids) } })),
          findInChunks(manifestAlbumIds, (ids) => this.albums.find({ where: { id: In(ids) } })),
          findInChunks(manifestPersonIds, (ids) => this.persons.find({ where: { id: In(ids) } })),
          findInChunks(manifestShareIds, (ids) => this.shares.find({ where: { id: In(ids) } })),
          findInChunks(manifestTokens, (ids) =>
            this.shares.find({ where: { token: In(ids) }, select: { token: true } }),
          ),
        ]);
      const globalFileById = new Map(globalFiles.map((row) => [row.id, row]));
      const globalAssetById = new Map(globalAssets.map((row) => [row.id, row]));
      const globalAlbumById = new Map(globalAlbums.map((row) => [row.id, row]));
      const globalPersonById = new Map(globalPersons.map((row) => [row.id, row]));
      const globalShareIds = new Set(globalShares.map((row) => row.id));
      const tokenSet = new Set(tokensInUse.map((row) => row.token));

      const targetFileById = new Map(targetFiles.map((row) => [row.id, row]));
      const targetAssetById = new Map(targetAssets.map((row) => [row.id, row]));
      const targetAssetByFileId = new Map(targetAssets.map((row) => [row.fileId, row]));
      const fileByChecksum = new Map<string, FileRecord>();
      for (const file of targetFiles) {
        if (file.purpose === 'original' && !isDerivativeStorageKey(file.storageKey)) {
          fileByChecksum.set(file.checksumSha256, file);
        }
      }
      const albumIdMap = new Map(targetAlbums.map((album) => [album.id, album.id]));
      const albumAssetKeys = new Set(
        targetAlbumAssets.map((link) => `${link.albumId}:${link.assetId}`),
      );
      const shareTargetKeys = new Set(
        targetShares.map((share) =>
          share.kind === 'asset' ? `asset:${share.assetId}` : `album:${share.albumId}`,
        ),
      );

      const merged = { files: 0, assets: 0, albums: 0, albumAssets: 0, shares: 0, persons: 0 };
      const deduped = { files: 0, assets: 0 };
      const skipped = {
        files: 0,
        assets: 0,
        albums: 0,
        albumAssets: 0,
        shares: 0,
        persons: 0,
        shareTokenConflicts: 0,
        shareTargetConflicts: 0,
      };
      const filesToInsert: FileRecord[] = [];
      const assetsToInsert: Asset[] = [];
      const albumsToInsert: Album[] = [];
      const albumAssetsToInsert: AlbumAsset[] = [];
      const sharesToInsert: Share[] = [];
      const personsToInsert: Person[] = [];
      const downloads: { id: string; storageKey: string; sourceKey: string }[] = [];
      const reusedFileLinks: { fileId: string; assetId: string }[] = [];
      // Assets already present from a partial merge still need their derivative
      // jobs if the previous run died between the row/byte phases and the queue
      // phase. A force rerun re-queues them too, which is the recovery contract.
      const recoverAssetIds = new Set<string>();
      const assetIdMap = new Map<string, string>(targetAssets.map((row) => [row.id, row.id]));
      // Adoption inputs must stay separate from assetIdMap/albumIdMap: those maps
      // are pre-seeded with every existing target row, while these sets collect
      // only rows this merge now represents in the live account. `adoptionCopies`
      // maps target file id -> source/backup destination for the S3 copy phase.
      const adoptedAssetIds = new Set<string>();
      const adoptedFileIds = new Set<string>();
      const adoptedAlbumIds = new Set<string>();
      const adoptionCopies = new Map<string, { sourceKey: string; targetStorageKey: string }>();

      // Same manifest-entry shape a restore builds, plus the per-pipeline
      // regeneration reset (merged bytes are originals only).
      const buildAsset = (asset: UserBackupManifest['assets'][number], fileId: string): Asset =>
        this.assets.create({
          ...asset,
          userId: target.id,
          fileId,
          trashedAt: asset.trashedAt ? new Date(asset.trashedAt) : null,
          takenAt: asset.takenAt ? new Date(asset.takenAt) : null,
          metadataStatus: 'pending',
          metadataExtractedAt: null,
          transcodeFileId: null,
          phash: null,
          transcodeStatus: asset.kind === 'video' ? 'pending' : null,
          thumbnailStatus: 'pending',
          faceStatus: asset.kind === 'photo' ? 'pending' : null,
          embeddingStatus: asset.kind === 'photo' ? 'pending' : null,
        });

      /**
       * Shared "the bytes already exist as `file`" bookkeeping: remap the old
       * asset id (or insert the asset when the file is parked), then adopt the
       * file's key for the S3 copy phase and refill it locally when missing.
       */
      const planExistingFile = async (
        asset: UserBackupManifest['assets'][number],
        manifestFile: UserBackupManifest['files'][number],
        file: FileRecord,
        liveAsset?: Asset,
      ): Promise<void> => {
        deduped.files += 1;
        if (liveAsset) {
          // Same bytes already live: skip the old asset, but remap its id so
          // album links and shares attach to the live row.
          deduped.assets += 1;
          assetIdMap.set(asset.id, liveAsset.id);
          adoptedAssetIds.add(liveAsset.id);
        } else {
          const created = buildAsset(asset, file.id);
          assetsToInsert.push(created);
          merged.assets += 1;
          assetIdMap.set(asset.id, asset.id);
          adoptedAssetIds.add(asset.id);
          targetAssetById.set(asset.id, created);
          targetAssetByFileId.set(file.id, created);
          if (file.assetId === null) {
            reusedFileLinks.push({ fileId: file.id, assetId: asset.id });
          }
        }
        adoptedFileIds.add(file.id);
        adoptionCopies.set(file.id, {
          sourceKey: sourceKeyFor(manifestFile),
          targetStorageKey: file.storageKey,
        });
        if (!(await this.storage.exists(file.storageKey))) {
          downloads.push({
            id: file.id,
            storageKey: file.storageKey,
            sourceKey: sourceKeyFor(manifestFile),
          });
        }
      };

      for (const asset of manifest.assets) {
        const existing = globalAssetById.get(asset.id);
        if (existing) {
          if (existing.userId !== target.id) throw new ConflictException('merge-conflict');
          skipped.assets += 1;
          adoptedAssetIds.add(existing.id);
          recoverAssetIds.add(asset.id);
          const manifestFile = manifestFileById.get(asset.fileId);
          if (manifestFile) {
            skipped.files += 1;
            // Retry recovery: a prior partial run may have committed rows before
            // its byte phase — refill a missing target key from the source backup.
            const existingFile = targetFileById.get(existing.fileId);
            if (existingFile) {
              adoptedFileIds.add(existingFile.id);
              adoptionCopies.set(existingFile.id, {
                sourceKey: sourceKeyFor(manifestFile),
                targetStorageKey: existingFile.storageKey,
              });
              if (!(await this.storage.exists(existingFile.storageKey))) {
                downloads.push({
                  id: existingFile.id,
                  storageKey: existingFile.storageKey,
                  sourceKey: sourceKeyFor(manifestFile),
                });
              }
            }
          }
          assetIdMap.set(asset.id, asset.id);
          continue;
        }
        const manifestFile = manifestFileById.get(asset.fileId);
        if (!manifestFile) {
          skipped.assets += 1;
          continue;
        }
        const foreignFile = globalFileById.get(manifestFile.id);
        if (foreignFile && foreignFile.userId !== target.id) {
          throw new ConflictException('merge-conflict');
        }

        const liveFile = fileByChecksum.get(manifestFile.checksumSha256);
        if (liveFile) {
          const liveAsset =
            targetAssetByFileId.get(liveFile.id) ??
            (liveFile.assetId ? targetAssetById.get(liveFile.assetId) : undefined);
          await planExistingFile(asset, manifestFile, liveFile, liveAsset);
          continue;
        }

        const sameIdFile = targetFileById.get(manifestFile.id);
        if (sameIdFile) {
          if (
            sameIdFile.purpose !== 'original' ||
            isDerivativeStorageKey(sameIdFile.storageKey) ||
            sameIdFile.checksumSha256 !== manifestFile.checksumSha256
          ) {
            throw new ConflictException('merge-conflict');
          }
          const liveAsset =
            targetAssetByFileId.get(sameIdFile.id) ??
            (sameIdFile.assetId ? targetAssetById.get(sameIdFile.assetId) : undefined);
          await planExistingFile(asset, manifestFile, sameIdFile, liveAsset);
          continue;
        }

        const storageKey = this.storage.buildKey(
          'original',
          target.id,
          manifestFile.id,
          extOf(manifestFile.storageKey),
        );
        const fileRow = this.files.create({
          id: manifestFile.id,
          userId: target.id,
          storageKey,
          originalName: manifestFile.originalName,
          mimeType: manifestFile.mimeType,
          sizeBytes: manifestFile.sizeBytes,
          checksumSha256: manifestFile.checksumSha256,
          purpose: 'original',
          assetId: asset.id,
        });
        filesToInsert.push(fileRow);
        const created = buildAsset(asset, manifestFile.id);
        assetsToInsert.push(created);
        merged.files += 1;
        merged.assets += 1;
        assetIdMap.set(asset.id, asset.id);
        adoptedAssetIds.add(asset.id);
        adoptedFileIds.add(manifestFile.id);
        adoptionCopies.set(manifestFile.id, {
          sourceKey: sourceKeyFor(manifestFile),
          targetStorageKey: storageKey,
        });
        targetFileById.set(manifestFile.id, fileRow);
        targetAssetById.set(asset.id, created);
        targetAssetByFileId.set(manifestFile.id, created);
        fileByChecksum.set(manifestFile.checksumSha256, fileRow);
        downloads.push({
          id: manifestFile.id,
          storageKey,
          sourceKey: sourceKeyFor(manifestFile),
        });
      }

      for (const album of manifest.albums) {
        const existing = globalAlbumById.get(album.id);
        if (existing) {
          if (existing.userId !== target.id) throw new ConflictException('merge-conflict');
          skipped.albums += 1;
          adoptedAlbumIds.add(album.id);
          albumIdMap.set(album.id, album.id);
          continue;
        }
        albumsToInsert.push(
          this.albums.create({
            id: album.id,
            userId: target.id,
            name: album.name,
            description: album.description,
            // an album the target already owns keeps its own flag (live wins on id collisions)
            hiddenFromTimeline: album.hiddenFromTimeline,
          }),
        );
        adoptedAlbumIds.add(album.id);
        albumIdMap.set(album.id, album.id);
        merged.albums += 1;
      }

      for (const link of manifest.albumAssets) {
        const albumId = albumIdMap.get(link.albumId);
        const assetId = assetIdMap.get(link.assetId);
        if (albumId === undefined || assetId === undefined) {
          skipped.albumAssets += 1;
          continue;
        }
        const key = `${albumId}:${assetId}`;
        if (albumAssetKeys.has(key)) {
          skipped.albumAssets += 1;
          continue;
        }
        albumAssetKeys.add(key);
        albumAssetsToInsert.push(this.albumAssets.create({ albumId, assetId }));
        merged.albumAssets += 1;
      }

      for (const share of manifest.shares) {
        if (globalShareIds.has(share.id)) {
          skipped.shares += 1;
          continue;
        }
        let targetAssetId: string | null = null;
        let targetAlbumId: string | null = null;
        if (share.kind === 'asset') {
          targetAssetId = share.assetId ? (assetIdMap.get(share.assetId) ?? null) : null;
          if (targetAssetId === null) {
            skipped.shares += 1;
            continue;
          }
        } else {
          targetAlbumId = share.albumId ? (albumIdMap.get(share.albumId) ?? null) : null;
          if (targetAlbumId === null) {
            skipped.shares += 1;
            continue;
          }
        }
        // Never mint a replacement token: a collision means the old capability
        // is already in use, so the link is dropped rather than silently reused.
        if (tokenSet.has(share.token)) {
          skipped.shares += 1;
          skipped.shareTokenConflicts += 1;
          continue;
        }
        const targetKey =
          share.kind === 'asset' ? `asset:${targetAssetId}` : `album:${targetAlbumId}`;
        if (shareTargetKeys.has(targetKey)) {
          skipped.shares += 1;
          skipped.shareTargetConflicts += 1;
          continue;
        }
        sharesToInsert.push(
          this.shares.create({
            id: share.id,
            userId: target.id,
            kind: share.kind,
            assetId: targetAssetId,
            albumId: targetAlbumId,
            token: share.token,
            expiresAt: share.expiresAt ? new Date(share.expiresAt) : null,
          }),
        );
        tokenSet.add(share.token);
        shareTargetKeys.add(targetKey);
        merged.shares += 1;
      }

      for (const person of manifest.persons) {
        const existing = globalPersonById.get(person.id);
        if (existing) {
          if (existing.userId !== target.id) throw new ConflictException('merge-conflict');
          skipped.persons += 1;
          continue;
        }
        personsToInsert.push(
          this.persons.create({
            id: person.id,
            userId: target.id,
            name: person.name,
            coverFaceId: null,
            clusterLabel: person.clusterLabel,
            faceCount: person.faceCount,
          }),
        );
        merged.persons += 1;
      }

      // Quota applies to the target's originals plus bytes actually copied; a
      // deduped file adds nothing. force is the operator escape hatch.
      const usedBytes = targetFiles
        .filter((file) => file.purpose === 'original' && !isDerivativeStorageKey(file.storageKey))
        .reduce((sum, file) => sum + Number(file.sizeBytes), 0);
      const incomingBytes = filesToInsert.reduce((sum, file) => sum + Number(file.sizeBytes), 0);
      const quota = loadEnv().STORAGE_QUOTA_BYTES;
      if (quota !== undefined && input.force !== true && usedBytes + incomingBytes > quota) {
        throw new PayloadTooLargeException(
          `Storage quota exceeded: used ${usedBytes} + incoming ${incomingBytes} > quota ${quota}`,
        );
      }

      // Rows first, one transaction — links land together so nothing is ever
      // orphan-eligible; reused files parked with assetId null get the new asset.
      await this.dataSource.transaction(async (manager: EntityManager) => {
        await bulkSave(manager, FileRecord, filesToInsert);
        await bulkSave(manager, Asset, assetsToInsert);
        await bulkSave(manager, Album, albumsToInsert);
        await bulkSave(manager, AlbumAsset, albumAssetsToInsert);
        await bulkSave(manager, Share, sharesToInsert);
        await bulkSave(manager, Person, personsToInsert);
        for (const link of reusedFileLinks) {
          await manager.update(FileRecord, link.fileId, { assetId: link.assetId });
        }
      });

      // Bytes second: rows already reference every key, so no stray sweep can fire
      // between the two phases. Existing keys are left alone (retry-friendly).
      await this.storageIo.downloadToStorage(downloads, 'photox-merge-', true);

      const derivativeAssetIds = new Set([
        ...assetsToInsert.map((asset) => asset.id),
        ...recoverAssetIds,
      ]);
      const enqueued =
        derivativeAssetIds.size === 0
          ? { metadata: 0, thumbnails: 0, videos: 0, faces: 0, ai: 0 }
          : await this.finalize.reenqueueDerivatives(target.id, derivativeAssetIds, 'merge');

      // Adopt the merged snapshot into the live account BEFORE the ledger: copy
      // originals into the live prefix, union manifests and write the union last.
      // Failure keeps the source and skips the ledger, so a plain retry is allowed.
      let assigned: MergeBackupResult['assigned'] = null;
      let adoptionError: string | undefined;
      try {
        const adopted = await this.adoptMergedBackup({
          target,
          sourceManifest: manifest,
          adoptedAssetIds,
          adoptedFileIds,
          adoptedAlbumIds,
          adoptionCopies,
        });
        assigned = { ...adopted, sourceDeleted: false };
      } catch (err) {
        adoptionError = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Backup adoption for ${target.id} from ${prefix} failed (${adoptionError}) — ` +
            'ledger not written, source kept; rerun the merge to retry',
        );
      }

      if (assigned !== null) {
        const mergedAt = new Date();
        const counts = { ...merged };
        if (prior) {
          await this.backupMerges.update(prior.id, { prefix, counts, mergedAt });
        } else {
          await this.backupMerges.save(
            this.backupMerges.create({
              backupUserId,
              targetUserId: target.id,
              prefix,
              counts,
              mergedAt,
            }),
          );
        }
        // Ledger is durable, so the source snapshot can go; keep the ledger
        // prefix as source-audit even though the S3 objects are now gone. Only
        // the merged prefix is deleted — other prefixes of this account id stay.
        assigned.sourceDeleted = await this.deleteMergedSourceBackup(prefix);
      }

      const completedAt = new Date().toISOString();
      this.logger.log(
        `Merged backup ${prefix} (source ${backupUserId}) into ${target.id}: ` +
          `files=${merged.files} assets=${merged.assets} albums=${merged.albums} ` +
          `albumAssets=${merged.albumAssets} shares=${merged.shares} persons=${merged.persons} ` +
          `dedupedFiles=${deduped.files} dedupedAssets=${deduped.assets} ` +
          `adopted=${assigned === null ? 'failed' : `${assigned.copiedObjects}/${assigned.reusedObjects}`} ` +
          `startedAt=${startedAt} completedAt=${completedAt} — cleanup-orphans may resume`,
      );
      const result: MergeBackupResult = {
        targetUserId: target.id,
        targetEmail: target.email,
        backupUserId,
        emailAtBackup: manifest.emailAtBackup,
        prefix,
        backedUpAt: manifest.backedUpAt,
        startedAt,
        completedAt,
        merged,
        deduped,
        skipped,
        enqueued,
        assigned,
      };
      if (adoptionError !== undefined) result.adoptionError = adoptionError;
      return result;
    } finally {
      this.mergesInFlight.delete(guardKey);
    }
  }

  /**
   * Adopts a successfully merged source snapshot into the live account's own
   * prefix: re-reads the rows this merge now represents, projects them with the
   * shared manifest helpers, unions with any existing live manifest (live wins),
   * server-side copies missing originals, then writes and HEAD-verifies the
   * union manifest LAST. Throws on any failure — the caller keeps the source
   * snapshot, skips the ledger and reports the error, so a plain retry is allowed.
   */
  private async adoptMergedBackup(params: {
    target: User;
    sourceManifest: UserBackupManifest;
    adoptedAssetIds: Set<string>;
    adoptedFileIds: Set<string>;
    adoptedAlbumIds: Set<string>;
    adoptionCopies: Map<string, { sourceKey: string; targetStorageKey: string }>;
  }): Promise<{
    prefix: string;
    copiedObjects: number;
    reusedObjects: number;
    unionedWithExisting: boolean;
  }> {
    const {
      target,
      sourceManifest,
      adoptedAssetIds,
      adoptedFileIds,
      adoptedAlbumIds,
      adoptionCopies,
    } = params;
    const targetPrefix = backupPrefix(target.email, target.id);
    const targetManifestKey = manifestKey(target.email, target.id);

    const [adoptedFiles, adoptedAssets, adoptedAlbums, adoptedShares, adoptedPersons] =
      await Promise.all([
        adoptedFileIds.size > 0
          ? this.files.find({ where: { id: In([...adoptedFileIds]) } })
          : Promise.resolve([] as FileRecord[]),
        adoptedAssetIds.size > 0
          ? this.assets.find({ where: { id: In([...adoptedAssetIds]) } })
          : Promise.resolve([] as Asset[]),
        adoptedAlbumIds.size > 0
          ? this.albums.find({ where: { id: In([...adoptedAlbumIds]) } })
          : Promise.resolve([] as Album[]),
        sourceManifest.shares.length > 0
          ? this.shares.find({
              where: {
                id: In(sourceManifest.shares.map((share) => share.id)),
                userId: target.id,
              },
            })
          : Promise.resolve([] as Share[]),
        sourceManifest.persons.length > 0
          ? this.persons.find({
              where: {
                id: In(sourceManifest.persons.map((person) => person.id)),
                userId: target.id,
              },
            })
          : Promise.resolve([] as Person[]),
      ]);
    const adoptedAlbumAssets =
      adoptedAlbumIds.size > 0 && adoptedAssetIds.size > 0
        ? await this.albumAssets
            .createQueryBuilder('aa')
            .where('aa."albumId" IN (:...albumIds)', { albumIds: [...adoptedAlbumIds] })
            .andWhere('aa."assetId" IN (:...assetIds)', { assetIds: [...adoptedAssetIds] })
            .getMany()
        : [];

    const adopted: UserBackupManifest = {
      manifestVersion: 1,
      userId: target.id,
      emailAtBackup: target.email,
      backedUpAt: sourceManifest.backedUpAt,
      user: userToManifest(target),
      files: adoptedFiles.map(fileToManifestEntry),
      assets: adoptedAssets.map(assetToManifestEntry),
      albums: adoptedAlbums.map(albumToManifestEntry),
      albumAssets: adoptedAlbumAssets.map((link) => ({
        albumId: link.albumId,
        assetId: link.assetId,
      })),
      shares: adoptedShares.map(shareToManifestEntry),
      persons: adoptedPersons.map(personToManifestEntry),
    };

    // Never overwrite a live manifest we could not read: a missing one is a
    // first adoption (null), any other read/parse failure aborts the adoption.
    const liveRead = await this.storageIo.readManifest(targetManifestKey);
    if ('error' in liveRead && liveRead.error !== 'missing') {
      throw new ServiceUnavailableException('existing live backup manifest is unreadable');
    }
    const live = 'manifest' in liveRead ? liveRead.manifest : null;

    const union = unionBackupManifests(live, adopted);
    const listed = new Set(await this.s3.listKeys(targetPrefix));
    let copiedObjects = 0;
    let reusedObjects = 0;
    for (const [targetFileId, copy] of adoptionCopies) {
      const destKey = originalKey(
        target.email,
        target.id,
        targetFileId,
        extOf(copy.targetStorageKey),
      );
      if (listed.has(destKey)) {
        reusedObjects += 1;
        continue;
      }
      await this.s3.copyKey(copy.sourceKey, destKey);
      listed.add(destKey);
      copiedObjects += 1;
    }

    // Manifest LAST: every copied key is already present and verified by copy,
    // and the HEAD proves the union landed before the caller deletes the source.
    await this.s3.putObject(
      targetManifestKey,
      Buffer.from(JSON.stringify(union)),
      'application/json',
    );
    await this.s3.headObject(targetManifestKey);
    this.logger.log(
      `Adopted backup into ${targetPrefix} (${copiedObjects} copied, ${reusedObjects} reused, ` +
        `unionedWithExisting=${live !== null})`,
    );
    return {
      prefix: targetPrefix,
      copiedObjects,
      reusedObjects,
      unionedWithExisting: live !== null,
    };
  }

  /**
   * Best-effort removal of an adopted source snapshot after the ledger write.
   * Deletes only the located source prefix: other prefixes under the same
   * `backupUserId` are not this merge's business — a stale one left by a failed
   * rename may be the account's only other copy. Never throws: a failed sweep
   * reports `false` while the already-adopted live copy stays intact.
   */
  private async deleteMergedSourceBackup(sourcePrefix: string): Promise<boolean> {
    try {
      const doomed = await this.s3.listKeys(sourcePrefix);
      if (doomed.length > 0) await this.s3.deleteKeys(doomed);
      this.logger.log(`Deleted merged source backup ${sourcePrefix} (${doomed.length} object(s))`);
      return true;
    } catch (err) {
      this.logger.warn(
        `Failed to delete merged source backup ${sourcePrefix} ` +
          `(${err instanceof Error ? err.message : String(err)}) — leaving source bytes`,
      );
      return false;
    }
  }
}
