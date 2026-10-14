import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { isUUID } from 'class-validator'
import { randomUUID } from 'crypto'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { DataSource, EntityManager, Repository } from 'typeorm'
import {
  LocalStorageService,
  backupPrefix,
  findPrefixesForUserId,
  manifestKey,
  normalizeEmail,
  originalKey,
  parseBackupDir,
  resolveBackupPrefix,
} from '@photox/shared-config'
import { FACE_DETECTOR_KINDS, SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import { z } from 'zod'
import { Asset, FileRecord, Person } from '../database/entities'
import { Album } from '../albums/entities/album.entity'
import { AlbumAsset } from '../albums/entities/album-asset.entity'
import { Share } from '../shares/entities/share.entity'
import { User } from '../users/entities/user.entity'
import { BullMqService } from '../queue/bullmq.service'
import { SettingsService } from '../settings/settings.service'
import { PlacesResolveService } from '../places/places-resolve.service'
import { S3BackupService, isNotFound } from './s3-backup.service'

const fileManifestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  storageKey: z.string().min(1),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksumSha256: z.string(),
  purpose: z.literal('original'),
  assetId: z.string().uuid().nullable(),
})

const assetManifestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  kind: z.enum(['photo', 'video']),
  fileId: z.string().uuid(),
  isTrashed: z.boolean(),
  trashedAt: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  takenAt: z.string().nullable(),
  favorite: z.boolean(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  originalName: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
  cameraMake: z.string().nullable(),
  cameraModel: z.string().nullable(),
  lensModel: z.string().nullable(),
  orientation: z.number().int().nullable(),
  iso: z.number().int().nullable(),
  fNumber: z.number().nullable(),
  exposureTime: z.number().nullable(),
  focalLength: z.number().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  altitude: z.number().nullable(),
  placeCity: z.string().nullable(),
  placeAdmin1: z.string().nullable(),
  placeCountryCode: z.string().nullable(),
  placeTimezone: z.string().nullable(),
  placeDistanceKm: z.number().nullable(),
  fps: z.number().nullable(),
  codec: z.string().nullable(),
  hasAudio: z.boolean().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  metadataStatus: z.enum(['pending', 'ready', 'failed']),
  transcodeStatus: z.enum(['pending', 'ready', 'failed']).nullable(),
  thumbnailStatus: z.enum(['pending', 'ready', 'failed']).nullable(),
  faceStatus: z.enum(['pending', 'ready', 'failed']).nullable(),
  embeddingStatus: z.enum(['pending', 'ready', 'failed']).nullable(),
  faceCount: z.number().int().nullable(),
  // ponytail: transcodeFileId/phash never persist — restore nulls both (re-transcode
  // + metadata reprocess refill them), so they are absent by construction
})

const albumManifestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
})

const albumAssetManifestSchema = z.object({
  albumId: z.string().uuid(),
  assetId: z.string().uuid(),
})

const shareManifestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  kind: z.enum(['asset', 'album']),
  assetId: z.string().uuid().nullable(),
  albumId: z.string().uuid().nullable(),
  token: z.string(),
  expiresAt: z.string().nullable(),
})

const personManifestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().nullable(),
  clusterLabel: z.string().nullable(),
  faceCount: z.number().int(),
  // ponytail: coverFaceId dropped — it points at faces rows (regenerated with new
  // UUIDs), so restore always stores NULL and recluster assigns fresh covers
})

const userManifestSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['user', 'admin']),
  passwordHash: z.string(),
  displayName: z.string(),
  tokensValidAfter: z.string().nullable(),
})

const userBackupManifestSchema = z.object({
  manifestVersion: z.literal(1),
  userId: z.string().uuid(),
  emailAtBackup: z.string().email(),
  backedUpAt: z.string(),
  detector: z.enum(FACE_DETECTOR_KINDS),
  user: userManifestSchema,
  files: z.array(fileManifestSchema),
  assets: z.array(assetManifestSchema),
  albums: z.array(albumManifestSchema),
  albumAssets: z.array(albumAssetManifestSchema),
  shares: z.array(shareManifestSchema),
  persons: z.array(personManifestSchema),
})

export type UserBackupManifest = z.infer<typeof userBackupManifestSchema>

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? n : null
}

function toIntOrNull(value: number | string | null | undefined): number | null {
  const n = toNumberOrNull(value)
  return n === null ? null : Math.trunc(n)
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function extOf(storageKey: string): string {
  const base = storageKey.split('/').pop() ?? storageKey
  const dot = base.lastIndexOf('.')
  return dot < 0 ? '' : base.slice(dot + 1)
}

// Thumbnails register with purpose='original' (FileRecord only has
// 'original'|'transcode') but live under derivatives/thumbnails/..., so purpose
// alone cannot isolate original bytes — storageKey prefix is the arbiter.
function isDerivativeStorageKey(storageKey: string): boolean {
  return storageKey.startsWith('derivatives/')
}

/** Previous-manifest file entry used by the incremental upload gate. */
export interface PreviousFileEntry {
  checksumSha256: string
  sizeBytes: number
}

/**
 * Pure incremental-upload gate: skip the S3 PUT only when all four hold —
 * the previous manifest has this file id, checksum matches, size matches, and
 * the destination key is already listed under the new prefix. Any miss (null
 * map, unknown id, changed bytes, S3-missing key) forces a re-upload.
 */
export function shouldSkipUpload(
  prev: Map<string, PreviousFileEntry> | null,
  listed: Set<string>,
  file: { id: string; checksumSha256: string; sizeBytes: number },
  key: string,
): boolean {
  if (prev === null) return false
  const entry = prev.get(file.id)
  if (entry === undefined) return false
  if (entry.checksumSha256 !== file.checksumSha256) return false
  if (entry.sizeBytes !== file.sizeBytes) return false
  if (!listed.has(key)) return false
  return true
}

function errorName(err: unknown): string {
  return (err as { name?: string }).name ?? 'Unknown'
}

export interface BackupResult {
  userId: string
  email: string
  prefix: string
  backedUpAt: string
  files: number
  assets: number
  albums: number
  shares: number
  persons: number
  uploaded: number
  skipped: number
}

export interface RestoreResult extends BackupResult {
  restoredFrom: string
  startedAt: string
  completedAt: string
  enqueued: { metadata: number; thumbnails: number; videos: number; faces: number; ai: number }
}

export interface BackupStatus {
  exists: boolean
  degraded?: 'unreadable' | 'corrupt'
  userId?: string
  emailAtBackup?: string
  backedUpAt?: string
  files?: number
  assets?: number
  albums?: number
  shares?: number
  persons?: number
}

export interface BackupProgress {
  userId: string
  inProgress: boolean
  total: number
  completed: number
  uploaded: number
  skipped: number
  currentFile?: string
  startedAt: string
  updatedAt: string
}

export interface BackupOverviewRow {
  userId: string
  email: string
  role: 'user' | 'admin'
  totalAssets: number
  backedUpAssets: number
  backedUpFiles: number
  backedUpAt: string | null
  exists: boolean
  degraded?: 'unreadable' | 'corrupt'
  notBackedUp: number
}

/**
 * Pure row math for the admin backups overview: live DB count vs manifest
 * counts, with the notBackedUp clamp (a newer backup can hold more assets
 * than the live DB after deletes — never report a negative gap).
 */
export function buildBackupOverviewRow(
  user: Pick<User, 'id' | 'email' | 'role'>,
  totalAssets: number,
  status: BackupStatus,
): BackupOverviewRow {
  const backedUpAssets = status.assets ?? 0
  const backedUpFiles = status.files ?? 0
  const row: BackupOverviewRow = {
    userId: user.id,
    email: user.email,
    role: user.role,
    totalAssets,
    backedUpAssets,
    backedUpFiles,
    backedUpAt: status.backedUpAt ?? null,
    exists: status.exists,
    notBackedUp: Math.max(0, totalAssets - backedUpAssets),
  }
  if (status.degraded !== undefined) row.degraded = status.degraded
  return row
}

/**
 * Per-user backup/restore: user-scoped rows + original bytes to S3 (Floci,
 * docker-only), same-UUID reinsert + derivative regeneration on restore.
 *
 * Backup set: users row (same UUID) + files (originals only — transcode rows are
 * dropped, videos re-transcode) + assets + albums + album_assets + shares +
 * persons. Skipped: refresh_tokens (restored clients re-login), faces/embeddings/
 * ocr/detections/thumbnails (all regenerable via re-enqueue). Trashed rows+bytes
 * travel as-is and stay degraded (reprocess filters exclude trashed).
 *
 * Restore runs rows-first in one transaction (fresh `createdAt = now()` keeps new
 * rows inside the orphan grace window), bytes second — the reverse order would
 * leave strays the next cleanup-orphans run deletes.
 *
 * HARD PREREQUISITE (M4): pause cleanup-orphans for the WHOLE restore — never run
 * `POST /api/v1/admin/cleanup-orphans/run` (or any automated sweep) mid-restore.
 * Restored rows use `now()` timestamps inside the ~10-minute orphan grace window,
 * so a sweep past that window deletes freshly restored bytes/rows. Multi-GB
 * restores can exceed 10 minutes — keep the sweeper paused until the restore
 * completion log line (with startedAt/completedAt) appears. No lock is held in
 * code; the operator owns the pause.
 *
 * Stale-until-jobs-complete (A2/A3): derivative statuses restore as-was while the
 * bytes/jobs are still outstanding — transcode/thumbnail/face/embedding statuses
 * stay stale until their re-enqueued jobs complete, `metadataStatus` is reset to
 * `pending` for every asset (M2 covers videos too) and refills via metadata jobs,
 * and `persons.faceCount` stays stale until the restore cluster job assigns fresh
 * covers/counts.
 *
 * Email changes auto-rename prefixes (A6): the S3 layout is keyed by backup-time
 * email (`backups/<email>__<userId>/`), so backupUser copy-forwards bytes from
 * every stale same-userId prefix into the current one (server-side copy, manifest
 * skipped and rewritten fresh), gates uploads on the previous manifest + a
 * pre-loop listKeys of the new prefix (uploaded/skipped counters), prunes the
 * new prefix before the manifest lands (M3: bytes first, manifest last, HEAD
 * verified), then deletes the old prefixes — restores still resolve by userId
 * suffix for any leftover orphans.
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
  private readonly logger = new Logger(UserBackupService.name)
  // ponytail: in-memory progress only (no DB/S3 row) — backupUser mutates the
  // entry each file while GET backups/progress polls a copy; a restart wipes
  // it and a rerun overwrites the stale entry, so never treat it as durable
  // history (upgrade path: persist the counters to app_settings/a job row)
  private readonly backupProgress = new Map<string, BackupProgress>()

  constructor(
    private readonly s3: S3BackupService,
    private readonly dataSource: DataSource,
    private readonly bullMq: BullMqService,
    private readonly settings: SettingsService,
    private readonly places: PlacesResolveService,
    private readonly storage: LocalStorageService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(FileRecord) private readonly files: Repository<FileRecord>,
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    @InjectRepository(Album) private readonly albums: Repository<Album>,
    @InjectRepository(AlbumAsset) private readonly albumAssets: Repository<AlbumAsset>,
    @InjectRepository(Share) private readonly shares: Repository<Share>,
    @InjectRepository(Person) private readonly persons: Repository<Person>,
  ) {}

  async backupUser(emailOrId: string): Promise<BackupResult> {
    const user = await this.findUser(emailOrId)
    if (!user) throw new NotFoundException(`No user for ${emailOrId}`)
    await this.s3.ensureBucket()

    // purpose='original' also matches thumbnail rows (they share the enum value
    // but live under derivatives/thumbnails/...), so the storageKey prefix is the
    // arbiter — keep both predicates, no register/storage layout change.
    const fileRowsPromise = this.files
      .createQueryBuilder('f')
      .where('f."userId" = :userId', { userId: user.id })
      .andWhere('f.purpose = :purpose', { purpose: 'original' })
      .andWhere('f."storageKey" LIKE :prefix', { prefix: 'originals/%' })
      .getMany()
    const [fileRows, assetRows, albumRows, shareRows, personRows] = await Promise.all([
      fileRowsPromise,
      this.assets.find({ where: { userId: user.id } }),
      this.albums.find({ where: { userId: user.id } }),
      this.shares.find({ where: { userId: user.id } }),
      this.persons.find({ where: { userId: user.id } }),
    ])
    const albumIds = albumRows.map((a) => a.id)
    const albumAssetRows =
      albumIds.length > 0
        ? await this.albumAssets
            .createQueryBuilder('aa')
            .where('aa."albumId" IN (:...ids)', { ids: albumIds })
            .getMany()
        : []

    const detector = await this.settings.getFaceDetector()
    const backedUpAt = new Date().toISOString()
    const manifest: UserBackupManifest = {
      manifestVersion: 1,
      userId: user.id,
      emailAtBackup: user.email,
      backedUpAt,
      detector,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        passwordHash: user.passwordHash,
        displayName: user.displayName,
        tokensValidAfter: toIsoOrNull(user.tokensValidAfter),
      },
      files: fileRows.map((f) => ({
        id: f.id,
        userId: f.userId,
        storageKey: f.storageKey,
        originalName: f.originalName,
        mimeType: f.mimeType,
        sizeBytes: Number(f.sizeBytes),
        checksumSha256: f.checksumSha256,
        purpose: 'original' as const,
        assetId: f.assetId,
      })),
      assets: assetRows.map((a) => ({
        id: a.id,
        userId: a.userId,
        kind: a.kind,
        fileId: a.fileId,
        isTrashed: a.isTrashed,
        trashedAt: toIsoOrNull(a.trashedAt),
        title: a.title,
        description: a.description,
        takenAt: toIsoOrNull(a.takenAt),
        favorite: a.favorite,
        mimeType: a.mimeType,
        sizeBytes: toIntOrNull(a.sizeBytes),
        originalName: a.originalName,
        width: a.width,
        height: a.height,
        durationSeconds: toNumberOrNull(a.durationSeconds),
        cameraMake: a.cameraMake,
        cameraModel: a.cameraModel,
        lensModel: a.lensModel,
        orientation: a.orientation,
        iso: a.iso,
        fNumber: toNumberOrNull(a.fNumber),
        exposureTime: toNumberOrNull(a.exposureTime),
        focalLength: toNumberOrNull(a.focalLength),
        latitude: toNumberOrNull(a.latitude),
        longitude: toNumberOrNull(a.longitude),
        altitude: toNumberOrNull(a.altitude),
        placeCity: a.placeCity,
        placeAdmin1: a.placeAdmin1,
        placeCountryCode: a.placeCountryCode,
        placeTimezone: a.placeTimezone,
        placeDistanceKm: toNumberOrNull(a.placeDistanceKm),
        fps: toNumberOrNull(a.fps),
        codec: a.codec,
        hasAudio: a.hasAudio,
        metadata: a.metadata,
        metadataStatus: a.metadataStatus,
        transcodeStatus: a.transcodeStatus,
        thumbnailStatus: a.thumbnailStatus,
        faceStatus: a.faceStatus,
        embeddingStatus: a.embeddingStatus,
        faceCount: a.faceCount,
      })),
      albums: albumRows.map((a) => ({
        id: a.id,
        userId: a.userId,
        name: a.name,
        description: a.description,
      })),
      albumAssets: albumAssetRows.map((aa) => ({ albumId: aa.albumId, assetId: aa.assetId })),
      shares: shareRows.map((s) => ({
        id: s.id,
        userId: s.userId,
        kind: s.kind,
        assetId: s.assetId,
        albumId: s.albumId,
        token: s.token,
        expiresAt: toIsoOrNull(s.expiresAt),
      })),
      persons: personRows.map((p) => ({
        id: p.id,
        userId: p.userId,
        name: p.name,
        clusterLabel: p.clusterLabel,
        faceCount: p.faceCount,
      })),
    }
    // zod runtime-validates the manifest we just built (fail fast, never upload garbage)
    const parsed = userBackupManifestSchema.parse(manifest)

    // ponytail: one-backup-per-user — fixed keys per user, a rerun overwrites the
    // previous backup in place. Bytes land FIRST, manifest LAST (M3): a mid-run
    // failure leaves the previous manifest (stale but consistent), never a live
    // manifest over missing bytes; a rerun re-uploads missing bytes then the
    // manifest, so rerun-after-failure is safe and idempotent.
    // Pre-fix backups uploaded thumbnail bytes as originals/<thumbFileId>.webp;
    // the originals/% query filter stops new uploads, so prune those stale keys
    // here (before the manifest, keeping bytes-first/manifest-last).
    // Incremental (manifest-diff + listKeys gate) + lazy email-change rename:
    // copy-forward stale same-userId prefixes, diff against the previous
    // manifest, gate each PUT on listed presence, prune the new prefix, write
    // the manifest LAST + HEAD-verify it, then delete old prefixes.
    const prefix = backupPrefix(user.email, user.id)
    const manifestObjectKey = manifestKey(user.email, user.id)
    const backupStartedAt = new Date().toISOString()
    this.backupProgress.set(user.id, {
      userId: user.id,
      inProgress: true,
      total: fileRows.length,
      completed: 0,
      uploaded: 0,
      skipped: 0,
      currentFile: undefined,
      startedAt: backupStartedAt,
      updatedAt: backupStartedAt,
    })
    try {
      let stalePrefixes: string[] = []
      try {
        stalePrefixes = await this.findStalePrefixesForUser(user.id, prefix)
      } catch (err) {
        this.logger.warn(
          `Stale prefix scan failed for user ${user.id} (${errorName(err)}) — skipping rename`,
        )
        stalePrefixes = []
      }
      if (stalePrefixes.length > 0) {
        try {
          await this.renameBackupPrefix(stalePrefixes, prefix)
        } catch (err) {
          this.logger.warn(
            `Backup rename failed for user ${user.id} (${err instanceof Error ? err.message : String(err)}) — continuing with direct upload`,
          )
        }
      }
      let prevFileMap = await this.loadPreviousFileMap(manifestObjectKey)
      if (prevFileMap === null) {
        for (const stale of stalePrefixes) {
          const fallback = await this.loadPreviousFileMap(`${stale}manifest.json`)
          if (fallback !== null) {
            prevFileMap = fallback
            break
          }
        }
      }
      let listedSet = new Set<string>()
      let canPrune = true
      try {
        listedSet = new Set(await this.s3.listKeys(prefix))
      } catch (err) {
        this.logger.warn(
          `Backup listKeys failed for ${prefix} (${errorName(err)}) — uploading all, skipping prune`,
        )
        listedSet = new Set<string>()
        canPrune = false
      }
      const expectedKeys = new Set(
        parsed.files.map((file) =>
          originalKey(user.email, user.id, file.id, extOf(file.storageKey)),
        ),
      )
      let uploaded = 0
      let skipped = 0
      for (const file of parsed.files) {
        const key = originalKey(user.email, user.id, file.id, extOf(file.storageKey))
        if (shouldSkipUpload(prevFileMap, listedSet, file, key)) {
          skipped += 1
          this.updateBackupProgress(user.id, {
            completed: skipped + uploaded,
            uploaded,
            skipped,
            currentFile: file.originalName,
          })
          continue
        }
        await this.s3.putFile(key, this.storage.pathFor(file.storageKey), file.mimeType)
        uploaded += 1
        listedSet.add(key)
        this.updateBackupProgress(user.id, {
          completed: skipped + uploaded,
          uploaded,
          skipped,
          currentFile: file.originalName,
        })
      }
      if (canPrune) {
        const staleKeys = [...listedSet].filter(
          (key) => key.startsWith(`${prefix}originals/`) && !expectedKeys.has(key),
        )
        if (staleKeys.length > 0) {
          await this.s3.deleteKeys(staleKeys)
          this.logger.log(
            `Pruned ${staleKeys.length} stale original(s) from pre-fix backup for user ${user.id}`,
          )
        }
      } else {
        this.logger.warn(`Skipping prune for user ${user.id} — new-prefix listing failed`)
      }
      await this.s3.putObject(
        manifestObjectKey,
        Buffer.from(JSON.stringify(parsed)),
        'application/json',
      )
      await this.s3.headObject(manifestObjectKey)
      for (const stale of stalePrefixes) {
        try {
          const oldKeys = await this.s3.listKeys(stale)
          if (oldKeys.length > 0) await this.s3.deleteKeys(oldKeys)
          this.logger.log(`Deleted old backup prefix ${stale} for user ${user.id}`)
        } catch (err) {
          this.logger.warn(
            `Failed to delete old backup prefix ${stale} (${errorName(err)}) — leaving orphan`,
          )
        }
      }

      this.finishBackupProgress(user.id)
      this.logger.log(
        `Backed up user ${user.id} (${fileRows.length} files, ${uploaded} uploaded, ${skipped} skipped) to ${prefix}`,
      )
      return {
        userId: user.id,
        email: user.email,
        prefix,
        backedUpAt,
        files: fileRows.length,
        assets: assetRows.length,
        albums: albumRows.length,
        shares: shareRows.length,
        persons: personRows.length,
        uploaded,
        skipped,
      }
    } catch (err) {
      this.finishBackupProgress(user.id)
      throw err
    }
  }

  async restoreUser(emailOrId: string): Promise<RestoreResult> {
    const startedAt = new Date().toISOString()
    this.logger.warn(
      `Restore started at ${startedAt} — keep cleanup-orphans paused until restore ` +
        'completes; never run cleanup mid-restore (bytes land after rows, strays ' +
        'would be deleted; restored rows use now() inside the ~10-min grace window)',
    )
    await this.s3.ensureBucket()
    const located = await this.locateBackup(emailOrId)
    const raw = await this.s3.getBuffer(located.manifestObjectKey)
    // zod runtime-validates the downloaded manifest (untrusted S3 bytes)
    const manifest = userBackupManifestSchema.parse(JSON.parse(raw.toString('utf-8')))
    if (manifest.userId !== located.userId) {
      throw new Error(
        `Backup manifest userId ${manifest.userId} does not match prefix user ${located.userId}`,
      )
    }

    // Legacy manifests (pre thumbnail-leak fix) embed derivatives/thumbnails/...
    // rows with purpose='original' — skip them on restore while still restoring
    // old originals; derivatives regenerate via reenqueueDerivatives below.
    const originalFiles = manifest.files.filter((f) => !isDerivativeStorageKey(f.storageKey))
    if (originalFiles.length !== manifest.files.length) {
      this.logger.warn(
        `Restore skipping ${manifest.files.length - originalFiles.length} derivative ` +
          `file(s) from legacy manifest for user ${manifest.userId}`,
      )
    }

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
          email: manifest.user.email,
          role: manifest.user.role,
          passwordHash: manifest.user.passwordHash,
          displayName: manifest.user.displayName,
          tokensValidAfter: manifest.user.tokensValidAfter
            ? new Date(manifest.user.tokensValidAfter)
            : null,
        }),
      )
      for (const f of originalFiles) {
        await manager.save(
          FileRecord,
          manager.create(FileRecord, {
            id: f.id,
            userId: f.userId,
            storageKey: f.storageKey,
            originalName: f.originalName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            checksumSha256: f.checksumSha256,
            purpose: 'original' as const,
            assetId: f.assetId,
          }),
        )
      }
      for (const a of manifest.assets) {
        await manager.save(
          Asset,
          manager.create(Asset, {
            ...a,
            trashedAt: a.trashedAt ? new Date(a.trashedAt) : null,
            takenAt: a.takenAt ? new Date(a.takenAt) : null,
            // restore transforms: re-transcode videos, refill phash via metadata jobs
            transcodeFileId: null,
            phash: null,
            metadataStatus: 'pending' as const,
            metadataExtractedAt: null,
          }),
        )
      }
      for (const a of manifest.albums) {
        await manager.save(
          Album,
          manager.create(Album, {
            id: a.id,
            userId: a.userId,
            name: a.name,
            description: a.description,
          }),
        )
      }
      for (const aa of manifest.albumAssets) {
        await manager.save(
          AlbumAsset,
          manager.create(AlbumAsset, { albumId: aa.albumId, assetId: aa.assetId }),
        )
      }
      for (const s of manifest.shares) {
        await manager.save(
          Share,
          manager.create(Share, {
            id: s.id,
            userId: s.userId,
            kind: s.kind,
            assetId: s.assetId,
            albumId: s.albumId,
            token: s.token,
            expiresAt: s.expiresAt ? new Date(s.expiresAt) : null,
          }),
        )
      }
      for (const p of manifest.persons) {
        await manager.save(
          Person,
          manager.create(Person, {
            id: p.id,
            userId: p.userId,
            name: p.name,
            coverFaceId: null,
            clusterLabel: p.clusterLabel,
            faceCount: p.faceCount,
          }),
        )
      }
    })

    // bytes second — rows already reference every key, so no stray sweep can fire
    const tmpRoot = await mkdtemp(join(tmpdir(), 'photox-restore-'))
    try {
      for (const f of originalFiles) {
        const tmp = join(tmpRoot, `${f.id}.${randomUUID()}.tmp`)
        await this.s3.downloadToFile(
          originalKey(manifest.emailAtBackup, manifest.userId, f.id, extOf(f.storageKey)),
          tmp,
        )
        // pathFor containment rejects escaped storageKeys before any byte lands
        await this.storage.save(f.storageKey, tmp)
      }
    } finally {
      await rm(tmpRoot, { recursive: true, force: true })
    }

    const enqueued = await this.reenqueueDerivatives(manifest.userId)
    const completedAt = new Date().toISOString()
    this.logger.log(
      `Restored user ${manifest.userId} (${originalFiles.length} files) ` +
        `startedAt=${startedAt} completedAt=${completedAt} — cleanup-orphans may resume`,
    )
    return {
      userId: manifest.userId,
      email: manifest.emailAtBackup,
      prefix: located.prefix,
      backedUpAt: manifest.backedUpAt,
      restoredFrom: located.manifestObjectKey,
      startedAt,
      completedAt,
      files: originalFiles.length,
      assets: manifest.assets.length,
      albums: manifest.albums.length,
      shares: manifest.shares.length,
      persons: manifest.persons.length,
      // restore downloads bytes (no incremental S3 gate) — zero counters keep the
      // BackupResult extension satisfied without implying skipped uploads
      uploaded: 0,
      skipped: 0,
      enqueued,
    }
  }

  async backupStatus(emailOrId: string): Promise<BackupStatus> {
    try {
      await this.s3.ensureBucket()
    } catch {
      throw new ServiceUnavailableException('Backup storage (S3) unreachable')
    }
    let located
    try {
      located = await this.locateBackup(emailOrId)
    } catch (err) {
      if (err instanceof NotFoundException) return { exists: false }
      throw new ServiceUnavailableException('Backup storage (S3) unreachable')
    }
    let raw: Buffer
    try {
      raw = await this.s3.getBuffer(located.manifestObjectKey)
    } catch (err) {
      if (isNotFound(err)) return { exists: false }
      const name = (err as { name?: string }).name ?? 'Unknown'
      try {
        await this.s3.headObject(located.manifestObjectKey)
      } catch (headErr) {
        if (isNotFound(headErr)) return { exists: false }
        throw new ServiceUnavailableException('Backup storage (S3) unreachable')
      }
      this.logger.warn(
        `Backup manifest at ${located.manifestObjectKey} unreadable (${name}) — ` +
          'object exists, reporting degraded status',
      )
      return { exists: true, degraded: 'unreadable', ...this.prefixIdentity(located) }
    }
    let manifest: UserBackupManifest
    try {
      manifest = userBackupManifestSchema.parse(JSON.parse(raw.toString('utf-8')))
    } catch (err) {
      // never log the payload — the manifest carries the user's passwordHash
      const name = (err as { name?: string }).name ?? 'Unknown'
      this.logger.warn(
        `Backup manifest at ${located.manifestObjectKey} failed validation (${name}) — ` +
          'reporting degraded status',
      )
      return { exists: true, degraded: 'corrupt', ...this.manifestIdentity(raw, located) }
    }
    // Legacy manifests embed derivative rows — report original-only counts so a
    // pre-fix backup reads the same as the bytes a new backup would upload.
    const originalFiles = manifest.files.filter((f) => !isDerivativeStorageKey(f.storageKey))
    return {
      exists: true,
      userId: manifest.userId,
      emailAtBackup: manifest.emailAtBackup,
      backedUpAt: manifest.backedUpAt,
      files: originalFiles.length,
      assets: manifest.assets.length,
      albums: manifest.albums.length,
      shares: manifest.shares.length,
      persons: manifest.persons.length,
    }
  }

  /**
   * Admin backups-table overview: one row per user joining the live DB asset
   * count with that user's S3 manifest status.
   * ponytail: O(users) S3 manifest reads via Promise.all over backupStatus
   * (plus one grouped DB count) — fine for personal-library scale (tens of
   * users); upgrade path is a single base listKeys + batched getBuffers when
   * user counts grow. S3-down still throws 503 via backupStatus (no partial
   * table) so a red table never masquerades as "nobody backed up".
   */
  async backupOverview(): Promise<BackupOverviewRow[]> {
    const users = await this.users.find({ order: { email: 'ASC' } })
    if (users.length === 0) return []
    const ids = users.map((u) => u.id)
    const counts = await this.assets
      .createQueryBuilder('a')
      .select('a."userId"', 'userId')
      .addSelect('COUNT(*)', 'count')
      .where('a."userId" IN (:...ids)', { ids })
      .groupBy('a."userId"')
      .getRawMany<{ userId: string; count: string }>()
    const totalByUser = new Map<string, number>()
    for (const row of counts) totalByUser.set(row.userId, Number(row.count))
    const statuses = await Promise.all(users.map((u) => this.backupStatus(u.id)))
    return users.map((user, i) =>
      buildBackupOverviewRow(user, totalByUser.get(user.id) ?? 0, statuses[i]!),
    )
  }

  /**
   * Live per-file snapshot of the current (or last) backup run for one user.
   * Unknown users throw like backupUser; known users with no run yet get an
   * idle zero snapshot (queried-at timestamps — meaningless while total is 0).
   * Returns a copy so pollers cannot mutate the stored entry.
   */
  async getBackupProgress(emailOrId: string): Promise<BackupProgress> {
    const user = await this.findUser(emailOrId)
    if (!user) throw new NotFoundException(`No user for ${emailOrId}`)
    const current = this.backupProgress.get(user.id)
    if (current) return { ...current }
    const now = new Date().toISOString()
    return {
      userId: user.id,
      inProgress: false,
      total: 0,
      completed: 0,
      uploaded: 0,
      skipped: 0,
      currentFile: undefined,
      startedAt: now,
      updatedAt: now,
    }
  }

  /** Per-iteration mutation of the stored entry (no-op when absent). */
  private updateBackupProgress(
    userId: string,
    patch: Pick<BackupProgress, 'completed' | 'uploaded' | 'skipped' | 'currentFile'>,
  ): void {
    const current = this.backupProgress.get(userId)
    if (!current) return
    current.completed = patch.completed
    current.uploaded = patch.uploaded
    current.skipped = patch.skipped
    current.currentFile = patch.currentFile
    current.updatedAt = new Date().toISOString()
  }

  /** Clears the in-progress flag on success AND failure (callers rethrow). */
  private finishBackupProgress(userId: string): void {
    const current = this.backupProgress.get(userId)
    if (!current) return
    current.inProgress = false
    current.updatedAt = new Date().toISOString()
  }

  /**
   * Best-effort identity for a degraded (unreadable) manifest: the userId from
   * the located prefix plus the backup-time email parsed back out of the
   * `<email>__<userId>` folder segment. Counts are omitted — the body never
   * arrived — and backedUpAt is unknowable without the manifest.
   */
  private prefixIdentity(located: { prefix: string; userId: string }): {
    userId: string
    emailAtBackup?: string
  } {
    const identity: { userId: string; emailAtBackup?: string } = { userId: located.userId }
    try {
      const base = resolveBackupPrefix()
      const stripped =
        base && located.prefix.startsWith(base) ? located.prefix.slice(base.length) : located.prefix
      const dir = stripped.replace(/\/+$/, '').split('/').pop() ?? stripped
      const parsed = parseBackupDir(dir)
      if (parsed.userId === located.userId) identity.emailAtBackup = parsed.email
    } catch {
      // email stays omitted — userId alone still identifies the backup
    }
    return identity
  }

  /**
   * Best-effort identity for a corrupt manifest: identifying fields pulled from
   * the raw bytes where present (never the secret payload), falling back to the
   * prefix-derived email. Counts are omitted — a failed schema parse means no
   * count is trustworthy.
   */
  private manifestIdentity(
    raw: Buffer,
    located: { prefix: string; userId: string },
  ): { userId: string; emailAtBackup?: string; backedUpAt?: string } {
    const identity: { userId: string; emailAtBackup?: string; backedUpAt?: string } = {
      ...this.prefixIdentity(located),
    }
    try {
      const partial = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>
      if (typeof partial.userId === 'string' && partial.userId.length > 0) {
        identity.userId = partial.userId
      }
      if (typeof partial.emailAtBackup === 'string' && partial.emailAtBackup.length > 0) {
        identity.emailAtBackup = partial.emailAtBackup
      }
      if (typeof partial.backedUpAt === 'string' && partial.backedUpAt.length > 0) {
        identity.backedUpAt = partial.backedUpAt
      }
    } catch {
      // raw bytes are not JSON at all — prefix-derived identity stands
    }
    return identity
  }

  private async findUser(emailOrId: string): Promise<User | null> {
    // M1: non-UUID email input must never reach the uuid-typed id lookup — Postgres
    // raises 22P02 (500) before the email fallback runs (precedent: assets.service
    // isUUID guard). UUIDs take the by-id fast path, everything else goes email-only.
    if (isUUID(emailOrId)) {
      const byId = await this.users.findOne({ where: { id: emailOrId } })
      if (byId) return byId
    }
    return this.users.findOne({ where: { email: normalizeEmail(emailOrId) } })
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
    let raw: Buffer
    try {
      raw = await this.s3.getBuffer(manifestObjectKey)
    } catch (err) {
      if (isNotFound(err)) {
        this.logger.log(`No previous backup manifest at ${manifestObjectKey} — full upload`)
      } else {
        this.logger.warn(
          `Previous backup manifest at ${manifestObjectKey} unreadable (${errorName(err)}) — full upload`,
        )
      }
      return null
    }
    try {
      const parsed = userBackupManifestSchema.parse(JSON.parse(raw.toString('utf-8')))
      const map = new Map<string, PreviousFileEntry>()
      for (const f of parsed.files) {
        if (isDerivativeStorageKey(f.storageKey)) continue
        map.set(f.id, { checksumSha256: f.checksumSha256, sizeBytes: f.sizeBytes })
      }
      return map
    } catch (err) {
      this.logger.warn(
        `Previous backup manifest at ${manifestObjectKey} corrupt (${errorName(err)}) — full upload`,
      )
      return null
    }
  }

  /**
   * Lists every stale same-userId prefix (old emails) excluding the current one,
   * via the shared findPrefixesForUserId helper over a base listing.
   */
  private async findStalePrefixesForUser(userId: string, currentPrefix: string): Promise<string[]> {
    const base = resolveBackupPrefix()
    const keys = await this.s3.listKeys(base)
    return findPrefixesForUserId(keys, base, userId).filter(
      (prefix: string) => prefix !== currentPrefix,
    )
  }

  /**
   * Lazy S3 rename: server-side copy-forward of every stale prefix into the
   * current prefix (manifests skipped — rewritten fresh after the upload loop).
   * Sequential per prefix; returns aggregate copy/skip counts for logging.
   */
  private async renameBackupPrefix(
    stalePrefixes: string[],
    newPrefix: string,
  ): Promise<{ copied: number; skipped: number }> {
    let copied = 0
    let skipped = 0
    for (const stale of stalePrefixes) {
      const result = await this.s3.copyPrefix(stale, newPrefix)
      copied += result.copied
      skipped += result.skipped
      this.logger.log(
        `Renamed backup prefix ${stale} -> ${newPrefix} (${result.copied} copied, ${result.skipped} skipped)`,
      )
    }
    return { copied, skipped }
  }

  /**
   * Resolves the S3 prefix for a user: DB row when present (email-first layout),
   * else an S3 scan matching the normalized email or userId suffix (fresh-DB
   * restore where no user row exists yet). Suffix matching splits folder names on
   * the LAST `__` (emails may contain `__`; UUIDs never contain `_`).
   */
  private async locateBackup(
    emailOrId: string,
  ): Promise<{ prefix: string; manifestObjectKey: string; userId: string }> {
    const user = await this.findUser(emailOrId)
    if (user) {
      return {
        prefix: backupPrefix(user.email, user.id),
        manifestObjectKey: manifestKey(user.email, user.id),
        userId: user.id,
      }
    }
    const base = resolveBackupPrefix()
    const keys = await this.s3.listKeys(base)
    const manifests = keys.filter((k) => k.endsWith('/manifest.json') && k.startsWith(base))
    const wantEmail = emailOrId.includes('@') ? normalizeEmail(emailOrId) : null
    for (const key of manifests) {
      const dir = key.slice(base.length, -'/manifest.json'.length)
      let parsed: { email: string; userId: string }
      try {
        parsed = parseBackupDir(dir)
      } catch {
        continue
      }
      if (wantEmail ? parsed.email === wantEmail : parsed.userId === emailOrId) {
        return { prefix: `${base}${dir}/`, manifestObjectKey: key, userId: parsed.userId }
      }
    }
    throw new NotFoundException(`No backup found for ${emailOrId}`)
  }

  /**
   * Derivative regeneration after restore, in pipeline order: metadata first for
   * both kinds (every restored asset is `pending`; mirrors the upload path which
   * enqueues process-metadata for photos and videos alike), thumbnails
   * photo+video, per-asset video loop (no admin bulk exists), faces re-embed,
   * embeddings/ocr/detect, cluster, then places backfill. Runs twice:
   * offset-paged readers assume a stable set, so a second pass catches anything
   * the first missed under concurrent writes (jobIds dedupe, making it idempotent).
   * Existing reprocess filters are reused untouched.
   */
  private async reenqueueDerivatives(userId: string): Promise<RestoreResult['enqueued']> {
    const detector = await this.settings.getFaceDetector()
    const totals = { metadata: 0, thumbnails: 0, videos: 0, faces: 0, ai: 0 }
    for (let pass = 0; pass < 2; pass++) {
      const assets = await this.assets.find({ where: { userId } })
      const live = assets.filter((a) => !a.isTrashed)
      for (const asset of live) {
        // M2: metadata for BOTH kinds — restore marks every asset pending and the
        // upload path enqueues process-metadata for photos and videos alike; the
        // photo-only admin backstop stays untouched.
        await this.bullMq.enqueue(
          'process-metadata',
          'process-metadata',
          { assetId: asset.id, fileId: asset.fileId, userId, kind: asset.kind },
          { jobId: `metadata-restore-${asset.id}`, removeOnComplete: true },
        )
        totals.metadata += pass === 0 ? 1 : 0
        await this.bullMq.enqueueThumbnails(asset.id, asset.fileId, userId, 'thumb-restore')
        totals.thumbnails += pass === 0 ? 4 : 0
        if (asset.kind === 'video') {
          await this.bullMq.enqueueVideo(asset.id, asset.fileId, userId, { reprocess: true })
          totals.videos += pass === 0 ? 1 : 0
        }
        if (asset.kind === 'photo') {
          await this.bullMq.enqueue(
            'process-faces',
            'process-faces',
            { assetId: asset.id, fileId: asset.fileId, userId, reason: 'restore', detector },
            { jobId: `face-restore-${asset.id}` },
          )
          totals.faces += pass === 0 ? 1 : 0
          await this.bullMq.enqueue(
            'process-embeddings',
            'process-embeddings',
            { assetId: asset.id, fileId: asset.fileId, userId, reason: 'restore' },
            { jobId: `embed-restore-${asset.id}-${SEARCH_EMBEDDING_MODEL}` },
          )
          await this.bullMq.enqueue(
            'process-ocr',
            'process-ocr',
            { assetId: asset.id, fileId: asset.fileId, userId, reason: 'restore' },
            { jobId: `ocr-restore-${asset.id}` },
          )
          await this.bullMq.enqueue(
            'process-detect',
            'process-detect',
            { assetId: asset.id, fileId: asset.fileId, userId, reason: 'restore' },
            { jobId: `detect-restore-${asset.id}` },
          )
          totals.ai += pass === 0 ? 3 : 0
        }
      }
    }
    await this.bullMq.enqueue(
      'process-faces-cluster',
      'cluster',
      { userId, reason: 'restore' },
      { jobId: `cluster-${userId}-restore-${Date.now()}` },
    )
    await this.backfillUserPlaces(userId)
    return totals
  }

  /** Per-user places backfill (mirrors the admin global loop, scoped to userId). */
  private async backfillUserPlaces(userId: string): Promise<void> {
    let afterId: string | null = null
    for (;;) {
      const qb = this.assets
        .createQueryBuilder('a')
        .select(['a.id AS id', 'a.latitude AS latitude', 'a.longitude AS longitude'])
        .where('a."userId" = :userId', { userId })
        .andWhere('a.latitude IS NOT NULL')
        .andWhere('a.longitude IS NOT NULL')
        .andWhere('a."placeCity" IS NULL')
        .orderBy('a.id', 'ASC')
        .limit(500)
      if (afterId !== null) qb.andWhere('a.id > :afterId', { afterId })
      const items = await qb.getRawMany<{ id: string; latitude: string; longitude: string }>()
      if (items.length === 0) break
      for (const item of items) {
        try {
          const place = await this.places.resolve(Number(item.latitude), Number(item.longitude))
          if (place) await this.assets.update(item.id, place)
        } catch (err) {
          this.logger.warn(`place backfill failed for asset ${item.id}: ${String(err)}`)
        }
      }
      afterId = items[items.length - 1]!.id
    }
  }
}
