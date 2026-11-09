import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { pipeline } from 'stream/promises';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  LocalStorageService,
  backupPrefix,
  findPrefixesForUserId,
  loadEnv,
  manifestKey,
  normalizeEmail,
  originalKey,
  parseBackupDir,
  resolveBackupPrefix,
} from '@photox/shared-config';
import { SEARCH_EMBEDDING_MODEL, type AdminUserBackupSync } from '@photox/shared-types';
import { z } from 'zod';
import { Asset, FileRecord, Person } from '../database/entities';
import { Album } from '../albums/entities/album.entity';
import { AlbumAsset } from '../albums/entities/album-asset.entity';
import { Share } from '../shares/entities/share.entity';
import { User } from '../users/entities/user.entity';
import { BullMqService } from '../queue/bullmq.service';
import { PlacesResolveService } from '../places/places-resolve.service';
import { S3BackupService, isNotFound } from './s3-backup.service';
import { backfillPlaces, type PlacesBackfillItem } from './places-backfill';
import { BackupMerge } from './entities/backup-merge.entity';
import { BackupRun, type BackupRunState } from './entities/backup-run.entity';
import { BackupRunItem } from './entities/backup-run-item.entity';

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
});

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
  metadata: z.record(z.string(), z.unknown()).nullable(),
  metadataStatus: z.enum(['pending', 'ready', 'failed']),
  transcodeStatus: z.enum(['pending', 'ready', 'failed']).nullable(),
  thumbnailStatus: z.enum(['pending', 'ready', 'failed']).nullable(),
  faceStatus: z.enum(['pending', 'ready', 'failed']).nullable(),
  embeddingStatus: z.enum(['pending', 'ready', 'failed']).nullable(),
  faceCount: z.number().int().nullable(),
  // ponytail: transcodeFileId/phash never persist — restore nulls both (re-transcode
  // + metadata reprocess refill them), so they are absent by construction
});

const albumManifestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
});

const albumAssetManifestSchema = z.object({
  albumId: z.string().uuid(),
  assetId: z.string().uuid(),
});

const shareManifestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  kind: z.enum(['asset', 'album']),
  assetId: z.string().uuid().nullable(),
  albumId: z.string().uuid().nullable(),
  token: z.string(),
  expiresAt: z.string().nullable(),
});

const personManifestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().nullable(),
  clusterLabel: z.string().nullable(),
  faceCount: z.number().int(),
  // ponytail: coverFaceId dropped — it points at faces rows (regenerated with new
  // UUIDs), so restore always stores NULL and recluster assigns fresh covers
});

const userManifestSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['user', 'admin']),
  passwordHash: z.string(),
  displayName: z.string(),
  tokensValidAfter: z.string().nullable(),
});

const userBackupManifestSchema = z.object({
  manifestVersion: z.literal(1),
  userId: z.string().uuid(),
  emailAtBackup: z.string().email(),
  backedUpAt: z.string(),
  user: userManifestSchema,
  files: z.array(fileManifestSchema),
  assets: z.array(assetManifestSchema),
  albums: z.array(albumManifestSchema),
  albumAssets: z.array(albumAssetManifestSchema),
  shares: z.array(shareManifestSchema),
  persons: z.array(personManifestSchema),
});

export type UserBackupManifest = z.infer<typeof userBackupManifestSchema>;

/**
 * Outcome of one manifest fetch + parse: the validated manifest, or the failure
 * tag (plus the raw cause so callers can log the S3/parse error name).
 */
type ManifestReadResult =
  | { manifest: UserBackupManifest }
  | { error: 'missing' | 'unreadable' | 'corrupt'; cause?: unknown };

function extOf(storageKey: string): string {
  return extname(storageKey).slice(1);
}

// Thumbnails register with purpose='original' (FileRecord only has
// 'original'|'transcode') but live under derivatives/thumbnails/..., so purpose
// alone cannot isolate original bytes — storageKey prefix is the arbiter.
function isDerivativeStorageKey(storageKey: string): boolean {
  return storageKey.startsWith('derivatives/');
}

// Shared row→manifest projections: backupUser and backup adoption (merge) must
// emit byte-identical entries for the same DB row, so both go through here.
function fileToManifestEntry(f: FileRecord): UserBackupManifest['files'][number] {
  return {
    id: f.id,
    userId: f.userId,
    storageKey: f.storageKey,
    originalName: f.originalName,
    mimeType: f.mimeType,
    sizeBytes: Number(f.sizeBytes),
    checksumSha256: f.checksumSha256,
    purpose: 'original',
    assetId: f.assetId,
  };
}

function assetToManifestEntry(a: Asset): UserBackupManifest['assets'][number] {
  return {
    id: a.id,
    userId: a.userId,
    kind: a.kind,
    fileId: a.fileId,
    isTrashed: a.isTrashed,
    trashedAt: a.trashedAt?.toISOString() ?? null,
    title: a.title,
    description: a.description,
    takenAt: a.takenAt?.toISOString() ?? null,
    favorite: a.favorite,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes === null ? null : Math.trunc(Number(a.sizeBytes)),
    originalName: a.originalName,
    width: a.width,
    height: a.height,
    durationSeconds: a.durationSeconds === null ? null : Number(a.durationSeconds),
    cameraMake: a.cameraMake,
    cameraModel: a.cameraModel,
    lensModel: a.lensModel,
    orientation: a.orientation,
    iso: a.iso,
    fNumber: a.fNumber === null ? null : Number(a.fNumber),
    exposureTime: a.exposureTime === null ? null : Number(a.exposureTime),
    focalLength: a.focalLength === null ? null : Number(a.focalLength),
    latitude: a.latitude === null ? null : Number(a.latitude),
    longitude: a.longitude === null ? null : Number(a.longitude),
    altitude: a.altitude === null ? null : Number(a.altitude),
    placeCity: a.placeCity,
    placeAdmin1: a.placeAdmin1,
    placeCountryCode: a.placeCountryCode,
    placeTimezone: a.placeTimezone,
    placeDistanceKm: a.placeDistanceKm === null ? null : Number(a.placeDistanceKm),
    fps: a.fps === null ? null : Number(a.fps),
    codec: a.codec,
    hasAudio: a.hasAudio,
    metadata: a.metadata,
    metadataStatus: a.metadataStatus,
    transcodeStatus: a.transcodeStatus,
    thumbnailStatus: a.thumbnailStatus,
    faceStatus: a.faceStatus,
    embeddingStatus: a.embeddingStatus,
    faceCount: a.faceCount,
  };
}

function albumToManifestEntry(a: Album): UserBackupManifest['albums'][number] {
  return {
    id: a.id,
    userId: a.userId,
    name: a.name,
    description: a.description,
  };
}

function shareToManifestEntry(s: Share): UserBackupManifest['shares'][number] {
  return {
    id: s.id,
    userId: s.userId,
    kind: s.kind,
    assetId: s.assetId,
    albumId: s.albumId,
    token: s.token,
    expiresAt: s.expiresAt?.toISOString() ?? null,
  };
}

function personToManifestEntry(p: Person): UserBackupManifest['persons'][number] {
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    clusterLabel: p.clusterLabel,
    faceCount: p.faceCount,
  };
}

function userToManifest(u: User): UserBackupManifest['user'] {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    passwordHash: u.passwordHash,
    displayName: u.displayName,
    tokensValidAfter: u.tokensValidAfter?.toISOString() ?? null,
  };
}

/** Previous-manifest file entry used by the incremental upload gate. */
export interface PreviousFileEntry {
  checksumSha256: string;
  sizeBytes: number;
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
  if (prev === null) return false;
  const entry = prev.get(file.id);
  if (entry === undefined) return false;
  if (entry.checksumSha256 !== file.checksumSha256) return false;
  if (entry.sizeBytes !== file.sizeBytes) return false;
  if (!listed.has(key)) return false;
  return true;
}

function errorName(err: unknown): string {
  return (err as { name?: string }).name ?? 'Unknown';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface BackupResult {
  userId: string;
  email: string;
  prefix: string;
  backedUpAt: string;
  files: number;
  assets: number;
  albums: number;
  shares: number;
  persons: number;
  uploaded: number;
  skipped: number;
}

export interface RestoreResult extends BackupResult {
  restoredFrom: { emailAtBackup: string; prefix: string; manifestObjectKey: string };
  startedAt: string;
  completedAt: string;
  enqueued: { metadata: number; thumbnails: number; videos: number; faces: number; ai: number };
  /**
   * Set when the restored email differs and re-homing the S3 prefix failed
   * (the restore itself still succeeded).
   */
  reassignmentError?: string;
}

export interface DeleteBackupResult {
  userId: string;
  email: string;
  prefix: string;
  deletedObjects: number;
}

export interface BackupStatus {
  exists: boolean;
  degraded?: 'unreadable' | 'corrupt';
  userId?: string;
  emailAtBackup?: string;
  role?: 'user' | 'admin';
  backedUpAt?: string;
  files?: number;
  assets?: number;
  albums?: number;
  shares?: number;
  persons?: number;
}

export interface BackupProgress {
  userId: string;
  inProgress: boolean;
  total: number;
  completed: number;
  uploaded: number;
  skipped: number;
  currentFile?: string;
  startedAt: string;
  updatedAt: string;
}

/** Items one sweeper pass may claim; small enough to keep S3/disk load bounded. */
const TRANSFER_BATCH_SIZE = 4;
const TRANSFER_MAX_ATTEMPTS = 5;
const TRANSFER_MAX_BACKOFF_MS = 5 * 60_000;
/** A crashed core leaves items 'running'; after this they are claimable again. */
const TRANSFER_CLAIM_TIMEOUT_MS = 30 * 60_000;

/** Per-run poller shape: counters plus the completed result (or the failure reason). */
export interface BackupRunStatus {
  id: string;
  kind: 'backup' | 'restore';
  userId: string;
  state: BackupRunState;
  total: number;
  completed: number;
  uploaded: number;
  skipped: number;
  failed: number;
  currentFile?: string;
  error?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  result?: BackupResult | RestoreResult;
}

interface ClaimedBackupItem {
  id: string;
  runId: string;
  fileId: string;
  storageKey: string;
  s3Key: string;
  checksumSha256: string | null;
  mimeType: string | null;
  attempts: number;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * TypeORM's Postgres driver returns UPDATE/DELETE results as `[rows, affected]`; SELECTs return
 * the rows directly. Normalize both so a claim/finalize query reads the same way.
 */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return result as T[];
}

/** One backup account snapshot surfaced in the admin overview/merge picker. */
export interface BackupSnapshot {
  userId: string;
  emailAtBackup: string;
  prefix: string;
  backedUpAt: string | null;
  assets: number;
  files: number;
  albums: number;
  shares: number;
  persons: number;
  exists: boolean;
  degraded?: 'unreadable' | 'corrupt';
  mergedAt?: string;
}

export interface BackupOverviewRow {
  userId: string;
  email: string;
  role: 'user' | 'admin';
  totalAssets: number;
  backedUpAssets: number;
  backedUpFiles: number;
  backedUpAt: string | null;
  exists: boolean;
  degraded?: 'unreadable' | 'corrupt';
  notBackedUp: number;
  deleted: boolean;
  emailAtBackup?: string;
  // Orphan rows use `prefix` to point at their S3 directory; live rows leave it
  // unset (previous-account sources are sub-row `legacyBackups` material).
  prefix?: string;
  legacyBackups?: BackupSnapshot[];
  backedUpAlbums?: number;
  backedUpShares?: number;
  backedUpPersons?: number;
  /** Non-terminal run for this user, so the admin UI resumes its state after a reload. */
  activeRun?: { id: string; kind: 'backup' | 'restore'; state: BackupRunState };
}

export interface MergeUserBackupInput {
  targetEmailOrId: string;
  backupUserId: string;
  prefix?: string;
  force?: boolean;
}

export interface MergeBackupResult {
  targetUserId: string;
  targetEmail: string;
  backupUserId: string;
  emailAtBackup: string;
  prefix: string;
  backedUpAt: string;
  startedAt: string;
  completedAt: string;
  merged: {
    files: number;
    assets: number;
    albums: number;
    albumAssets: number;
    shares: number;
    persons: number;
  };
  deduped: { files: number; assets: number };
  skipped: {
    files: number;
    assets: number;
    albums: number;
    albumAssets: number;
    shares: number;
    persons: number;
    shareTokenConflicts: number;
    shareTargetConflicts: number;
  };
  enqueued: { metadata: number; thumbnails: number; videos: number; faces: number; ai: number };
  // Adoption moves the source snapshot into the live account's prefix and unions
  // it with any existing live manifest. null means adoption failed: the merge
  // rows stay, the ledger/source delete are skipped and a retry is still allowed.
  assigned: {
    prefix: string;
    copiedObjects: number;
    reusedObjects: number;
    unionedWithExisting: boolean;
    sourceDeleted: boolean;
  } | null;
  adoptionError?: string;
}

function timeOf(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** Live-order-first id-keyed union: a live entry always wins a collision. */
function unionById<T extends { id: string }>(live: T[], adopted: T[]): T[] {
  const seen = new Set(live.map((item) => item.id));
  const merged = [...live];
  for (const item of adopted) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

/**
 * Pure manifest union for backup adoption after a merge: the live account's
 * manifest keeps precedence (its entries win on id collisions) and adopted-only
 * entries append in source order. Shares also dedupe by token so one capability
 * is never listed twice; album links dedupe by (albumId, assetId) pair.
 * Top-level identity comes from `adopted` (its user row is the live target) and
 * `backedUpAt` is the newer snapshot time. Inputs are already schema-validated on
 * the read path, so this only unions.
 */
export function unionBackupManifests(
  live: UserBackupManifest | null,
  adopted: UserBackupManifest,
): UserBackupManifest {
  if (live === null) return adopted;

  const shareIds = new Set(live.shares.map((share) => share.id));
  const shareTokens = new Set(live.shares.map((share) => share.token));
  const shares = [...live.shares];
  for (const share of adopted.shares) {
    if (shareIds.has(share.id) || shareTokens.has(share.token)) continue;
    shareIds.add(share.id);
    shareTokens.add(share.token);
    shares.push(share);
  }

  const albumAssetKeys = new Set(live.albumAssets.map((link) => `${link.albumId}:${link.assetId}`));
  const albumAssets = [...live.albumAssets];
  for (const link of adopted.albumAssets) {
    const key = `${link.albumId}:${link.assetId}`;
    if (albumAssetKeys.has(key)) continue;
    albumAssetKeys.add(key);
    albumAssets.push(link);
  }

  const backedUpAt =
    timeOf(adopted.backedUpAt) > timeOf(live.backedUpAt) ? adopted.backedUpAt : live.backedUpAt;
  return {
    manifestVersion: 1,
    userId: adopted.userId,
    emailAtBackup: adopted.emailAtBackup,
    backedUpAt,
    user: adopted.user,
    files: unionById(live.files, adopted.files),
    assets: unionById(live.assets, adopted.assets),
    albums: unionById(live.albums, adopted.albums),
    albumAssets,
    shares,
    persons: unionById(live.persons, adopted.persons),
  };
}

/** Newest snapshot by backedUpAt; unreadable/corrupt snapshots sort last. Stable on ties. */
function pickNewest<T extends { backedUpAt: string | null | undefined }>(items: T[]): T {
  let best = items[0]!;
  let bestTime = timeOf(best.backedUpAt);
  for (let i = 1; i < items.length; i++) {
    const candidate = items[i]!;
    const candidateTime = timeOf(candidate.backedUpAt);
    if (candidateTime > bestTime) {
      best = candidate;
      bestTime = candidateTime;
    }
  }
  return best;
}

interface BackupDirLocation {
  prefix: string;
  manifestObjectKey: string;
  email: string;
  userId: string;
}

function snapshotFromStatus(
  userId: string,
  prefixEmail: string,
  prefix: string,
  status: BackupStatus,
): BackupSnapshot {
  const snapshot: BackupSnapshot = {
    userId: status.userId ?? userId,
    emailAtBackup: status.emailAtBackup ?? prefixEmail,
    prefix,
    backedUpAt: status.backedUpAt ?? null,
    assets: status.assets ?? 0,
    files: status.files ?? 0,
    albums: status.albums ?? 0,
    shares: status.shares ?? 0,
    persons: status.persons ?? 0,
    exists: status.exists,
  };
  if (status.degraded !== undefined) snapshot.degraded = status.degraded;
  return snapshot;
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
  legacyBackups?: BackupSnapshot[],
): BackupOverviewRow {
  const backedUpAssets = status.assets ?? 0;
  const backedUpFiles = status.files ?? 0;
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
    deleted: false,
    backedUpAlbums: status.albums ?? 0,
    backedUpShares: status.shares ?? 0,
    backedUpPersons: status.persons ?? 0,
  };
  if (status.degraded !== undefined) row.degraded = status.degraded;
  if (legacyBackups !== undefined && legacyBackups.length > 0) {
    row.legacyBackups = legacyBackups;
  }
  return row;
}

/**
 * Pure orphan-row builder for the admin backups overview: deleted users have no
 * live DB row, so the backup itself supplies identity (manifest email/role with
 * prefix fallbacks) and live counts are zero (notBackedUp clamps to 0).
 * `emailAtBackup` is set only when the prefix-dir email differs from the
 * manifest email (stale rename leftover) — normally omitted.
 */
export function buildOrphanBackupOverviewRow(
  prefixEmail: string,
  prefixUserId: string,
  status: BackupStatus,
  prefix?: string,
): BackupOverviewRow {
  const backupEmail = status.emailAtBackup ?? prefixEmail;
  const role = status.role ?? 'user';
  const userId = status.userId ?? prefixUserId;
  const row = buildBackupOverviewRow({ id: userId, email: backupEmail, role }, 0, status);
  row.deleted = true;
  row.totalAssets = 0;
  row.notBackedUp = 0;
  if (prefix !== undefined) row.prefix = prefix;
  if (
    status.emailAtBackup !== undefined &&
    normalizeEmail(status.emailAtBackup) !== normalizeEmail(prefixEmail)
  ) {
    row.emailAtBackup = status.emailAtBackup;
  }
  return row;
}

/**
 * Pure fallback-email builder for restore-after-email-reuse: `restored-<ms>-<local>@<domain>`
 * (`<local>@<domain>` is the backup-time email), lowercased via normalizeEmail so the
 * result stays a valid email. `attempt > 0` appends `-<attempt>` to the local part to
 * keep the address valid while guaranteeing uniqueness (callers loop until free).
 */
export function buildFallbackEmail(origEmail: string, nowMs: number, attempt = 0): string {
  const normalized = normalizeEmail(origEmail);
  const at = normalized.lastIndexOf('@');
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const baseLocal = `restored-${nowMs}-${local}`;
  const finalLocal = attempt === 0 ? baseLocal : `${baseLocal}-${attempt}`;
  return normalizeEmail(`${finalLocal}@${domain}`);
}

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
 * failed/paused run is resumable (`startRestore` with the same manifest, or retryRun).
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
 * email (`backups/<email>__<userId>/`), so backupUser copy-forwards bytes from
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
  private readonly logger = new Logger(UserBackupService.name);
  // In-process merge mutual exclusion (`<backupUserId>:<targetUserId>`). The unique
  // ledger pair is the durable arbiter; this only turns a concurrent double-click
  // into a clean 409 before any bytes/rows are written.
  private readonly mergesInFlight = new Set<string>();

  constructor(
    private readonly s3: S3BackupService,
    private readonly dataSource: DataSource,
    private readonly bullMq: BullMqService,
    private readonly places: PlacesResolveService,
    private readonly storage: LocalStorageService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(FileRecord) private readonly files: Repository<FileRecord>,
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    @InjectRepository(Album) private readonly albums: Repository<Album>,
    @InjectRepository(AlbumAsset) private readonly albumAssets: Repository<AlbumAsset>,
    @InjectRepository(Share) private readonly shares: Repository<Share>,
    @InjectRepository(Person) private readonly persons: Repository<Person>,
    @InjectRepository(BackupMerge) private readonly backupMerges: Repository<BackupMerge>,
    @InjectRepository(BackupRun) private readonly runs: Repository<BackupRun>,
    @InjectRepository(BackupRunItem) private readonly runItems: Repository<BackupRunItem>,
  ) {}

  /**
   * Creates a backup run: snapshot the account, write the manifest draft, then the run + one
   * item per original that is not already in S3 (the incremental gate). The sweeper uploads
   * each item and the run finalizes with the manifest LAST — a run that fails never leaves a
   * live manifest over missing bytes.
   */
  async startBackup(emailOrId: string): Promise<{ runId: string }> {
    const user = await this.findUser(emailOrId);
    if (!user) throw new NotFoundException(`No user for ${emailOrId}`);
    await this.s3.ensureBucket();
    await this.assertNoActiveRun(user.id);
    await this.cleanupAbandonedBackupRuns(user.id);

    // purpose='original' also matches thumbnail rows (they share the enum value
    // but live under derivatives/thumbnails/...), so the storageKey prefix is the
    // arbiter — keep both predicates, no register/storage layout change.
    const fileRowsPromise = this.files
      .createQueryBuilder('f')
      .where('f."userId" = :userId', { userId: user.id })
      .andWhere('f.purpose = :purpose', { purpose: 'original' })
      .andWhere('f."storageKey" LIKE :prefix', { prefix: 'originals/%' })
      .getMany();
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
      stalePrefixes = await this.findStalePrefixesForUser(user.id, prefix);
    } catch (err) {
      this.logger.warn(
        `Stale prefix scan failed for user ${user.id} (${errorName(err)}) — skipping rename`,
      );
      stalePrefixes = [];
    }
    if (stalePrefixes.length > 0) {
      try {
        await this.renameBackupPrefix(stalePrefixes, prefix);
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
      await manager.insert(BackupRun, {
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
      });
      if (items.length > 0) await manager.insert(BackupRunItem, items);
    });

    this.logger.log(
      `Backup run ${runId} started for user ${user.id} (${items.length} to upload, ${skipped} unchanged)`,
    );
    return { runId };
  }

  /** Synchronous driver (tests + internal callers): start the run and process it to completion. */
  async backupUser(emailOrId: string): Promise<BackupResult> {
    const { runId } = await this.startBackup(emailOrId);
    await this.drainRun(runId);
    return this.completedBackupResult(runId);
  }

  /**
   * Relocates a user's backup to the prefix for the CURRENT email after an
   * account edit (A6): copy-forward every stale same-userId prefix, patch the
   * manifest identity block to the live user row, HEAD-verify the new manifest,
   * and only then delete the old prefixes. The old prefix (and its manifest)
   * survives until the new manifest is verified — same crash-safe ordering as
   * backupUser.
   *
   * Never throws, including when the target prefix itself cannot be computed
   * (loadEnv/zod failure, empty email/userId) — every path resolves to an
   * AdminUserBackupSync so callers report the failure instead of 500ing. Failures
   * are reported as `error`: an S3 outage (including a failed stale-prefix scan)
   * must never masquerade as the benign `reason: 'no-backup'`, which is reserved
   * for "no stale prefix and no manifest at the current prefix".
   *
   * `synced` means the backup now matches the live account; `moved` means the S3
   * prefix itself was relocated. A `synced: false` result is either benign or a
   * failure — never collapse the two: `reason: 'no-backup'` is the genuine
   * "nothing was ever backed up" case, while `error` reports a real problem
   * (stale-prefix scan/listing outage, unreadable manifest, copy or HEAD-verify
   * failure, unusable prefix).
   */
  async moveBackupPrefix(user: User): Promise<AdminUserBackupSync> {
    // computed outside the main try: a throw here must still return a result —
    // updateUser's fallback and syncUserBackup both call this and rely on it
    let to: string;
    try {
      to = backupPrefix(user.email, user.id);
    } catch (err) {
      const message = errorMessage(err);
      this.logger.warn(`Backup prefix unusable for user ${user.id} (${message})`);
      return { synced: false, moved: false, to: '', error: message };
    }
    try {
      await this.s3.ensureBucket();
      let stale: string[] = [];
      try {
        stale = await this.findStalePrefixesForUser(user.id, to);
      } catch (err) {
        // a listing outage is a failure to report, not "this user has no backup"
        const message = errorMessage(err);
        this.logger.warn(
          `Stale prefix scan failed for user ${user.id} (${errorName(err)}) — reporting sync failure`,
        );
        return { synced: false, moved: false, to, error: `stale prefix scan failed: ${message}` };
      }
      for (const prefix of stale) {
        await this.s3.copyPrefix(prefix, to);
      }
      // bytes are copied first (copyPrefix skips manifests), so the new manifest
      // is either already there (prior move) or only under a stale prefix
      const manifestObjectKey = `${to}manifest.json`;
      const readMove = async (key: string): Promise<UserBackupManifest | null> => {
        const read = await this.readManifest(key);
        if ('manifest' in read) return read.manifest;
        if (read.error === 'missing') this.logger.log(`No backup manifest at ${key}`);
        else this.logger.warn(`Backup manifest at ${key} ${read.error} (${errorName(read.cause)})`);
        return null;
      };
      let manifest = await readMove(manifestObjectKey);
      if (manifest === null) {
        for (const prefix of stale) {
          manifest = await readMove(`${prefix}manifest.json`);
          if (manifest !== null) break;
        }
      }
      if (manifest === null) {
        // stale prefixes carrying only bytes (no readable manifest) are an error:
        // the backup exists in some form, it just cannot be relocated safely
        if (stale.length > 0) {
          this.logger.warn(`Backup manifest unreadable for user ${user.id} (${to})`);
          return { synced: false, moved: false, to, error: 'backup manifest unreadable' };
        }
        this.logger.log(`No backup to move for user ${user.id} (${to})`);
        return { synced: false, moved: false, to, reason: 'no-backup' };
      }
      // bytes stay from the last backup; only the identity block must match the
      // live account so a later restore does not resurrect a stale email/hash
      const patched: UserBackupManifest = {
        ...manifest,
        emailAtBackup: user.email,
        user: {
          ...manifest.user,
          email: user.email,
          role: user.role,
          displayName: user.displayName,
          passwordHash: user.passwordHash,
          tokensValidAfter: user.tokensValidAfter
            ? new Date(user.tokensValidAfter).toISOString()
            : null,
        },
      };
      await this.s3.putObject(
        manifestObjectKey,
        Buffer.from(JSON.stringify(patched)),
        'application/json',
      );
      await this.s3.headObject(manifestObjectKey);
      // new manifest verified — the stale prefixes are now redundant copies
      await this.deletePrefixesQuietly(stale, user.id);
      this.logger.log(`Moved backup prefix for user ${user.id} to ${to}`);
      return stale.length > 0
        ? { synced: true, moved: true, from: stale[0]!, to }
        : { synced: true, moved: false, to };
    } catch (err) {
      const message = errorMessage(err);
      this.logger.warn(`Backup prefix move failed for user ${user.id} (${message})`);
      return { synced: false, moved: false, to, error: message };
    }
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
    await this.s3.ensureBucket();
    let located: { prefix: string; manifestObjectKey: string; userId: string };
    try {
      located = await this.locateBackup(emailOrId);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }
    // A live user with no exact manifest resolves to its exact prefix (so callers
    // can report exists:false) — the GET then 404s instead of leaking NoSuchKey.
    // zod runtime-validates the downloaded manifest (untrusted S3 bytes)
    const read = await this.readManifest(located.manifestObjectKey);
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
      await manager.save(
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
      await manager.save(
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
      await manager.save(
        Album,
        manifest.albums.map((a) => ({
          id: a.id,
          userId: a.userId,
          name: a.name,
          description: a.description,
        })),
      );
      await manager.save(
        AlbumAsset,
        manifest.albumAssets.map((aa) => ({ albumId: aa.albumId, assetId: aa.assetId })),
      );
      await manager.save(
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
      await manager.save(
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

      await manager.insert(BackupRun, {
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
      });
      if (items.length > 0) await manager.insert(BackupRunItem, items);
    });

    this.logger.log(
      `Restore run ${runId} started for user ${manifest.userId} (${originalFiles.length} files)`,
    );
    return { runId };
  }

  /** Synchronous driver (tests + internal callers): start the run and process it to completion. */
  async restoreUser(emailOrId: string, restoreEmail?: string): Promise<RestoreResult> {
    const { runId } = await this.startRestore(emailOrId, restoreEmail);
    await this.drainRun(runId);
    return this.completedRestoreResult(runId);
  }

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
   * is written last (HEAD-verified). The source prefix is then deleted, so the
   * account reads as a normal backed-up row instead of a legacyBackups sub-row.
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
    await this.ensureStorage();
    const target = await this.findUser(input.targetEmailOrId);
    if (!target) throw new NotFoundException(`No user for ${input.targetEmailOrId}`);
    if (!isUUID(input.backupUserId)) {
      throw new BadRequestException('backupUserId must be a UUID');
    }
    const backupUserId = input.backupUserId;
    if (backupUserId === target.id) throw new ConflictException('already-restored');
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
        found = await this.locateBackupByUserId(backupUserId);
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

    const read = await this.readManifest(`${prefix}manifest.json`);
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
      // a hard 409, never a silent overwrite or cross-account link.
      const [globalFiles, globalAssets, globalAlbums, globalPersons, globalShares, tokensInUse] =
        await Promise.all([
          manifestFileIds.length > 0
            ? this.files.find({ where: { id: In(manifestFileIds) } })
            : Promise.resolve([]),
          manifestAssetIds.length > 0
            ? this.assets.find({ where: { id: In(manifestAssetIds) } })
            : Promise.resolve([]),
          manifestAlbumIds.length > 0
            ? this.albums.find({ where: { id: In(manifestAlbumIds) } })
            : Promise.resolve([]),
          manifestPersonIds.length > 0
            ? this.persons.find({ where: { id: In(manifestPersonIds) } })
            : Promise.resolve([]),
          manifestShareIds.length > 0
            ? this.shares.find({ where: { id: In(manifestShareIds) } })
            : Promise.resolve([]),
          manifestTokens.length > 0
            ? this.shares.find({ where: { token: In(manifestTokens) }, select: { token: true } })
            : Promise.resolve([] as Share[]),
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

      // Same manifest-entry shape restoreUser builds, plus the per-pipeline
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
        for (const file of filesToInsert) await manager.save(FileRecord, file);
        for (const asset of assetsToInsert) await manager.save(Asset, asset);
        for (const album of albumsToInsert) await manager.save(Album, album);
        for (const link of albumAssetsToInsert) await manager.save(AlbumAsset, link);
        for (const share of sharesToInsert) await manager.save(Share, share);
        for (const person of personsToInsert) await manager.save(Person, person);
        for (const link of reusedFileLinks) {
          await manager.update(FileRecord, link.fileId, { assetId: link.assetId });
        }
      });

      // Bytes second: rows already reference every key, so no stray sweep can fire
      // between the two phases. Existing keys are left alone (retry-friendly).
      await this.downloadToStorage(downloads, 'photox-merge-', true);

      const derivativeAssetIds = new Set([
        ...assetsToInsert.map((asset) => asset.id),
        ...recoverAssetIds,
      ]);
      const enqueued =
        derivativeAssetIds.size === 0
          ? { metadata: 0, thumbnails: 0, videos: 0, faces: 0, ai: 0 }
          : await this.reenqueueDerivatives(target.id, derivativeAssetIds, 'merge');

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
        // prefix as source-audit even though the S3 objects are now gone.
        assigned.sourceDeleted = await this.deleteMergedSourceBackup(prefix, target, backupUserId);
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
    const liveRead = await this.readManifest(targetManifestKey);
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
   * Lists the backup root once, sweeps every prefix owned by `backupUserId`
   * (plus the located source prefix defensively) and never touches the live
   * account's own prefix. Never throws: a failed sweep reports `false` while
   * the already-adopted live copy stays intact.
   */
  private async deleteMergedSourceBackup(
    sourcePrefix: string,
    target: User,
    backupUserId: string,
  ): Promise<boolean> {
    try {
      const base = resolveBackupPrefix();
      const keys = await this.s3.listKeys(base);
      const prefixes = new Set(findPrefixesForUserId(keys, base, backupUserId));
      prefixes.add(sourcePrefix);
      prefixes.delete(backupPrefix(target.email, target.id));
      const prefixList = [...prefixes];
      const doomed = keys.filter((key) => prefixList.some((prefix) => key.startsWith(prefix)));
      if (doomed.length > 0) await this.s3.deleteKeys(doomed);
      this.logger.log(
        `Deleted merged source backup ${sourcePrefix} for ${backupUserId} ` +
          `(${doomed.length} object(s))`,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Failed to delete merged source backup ${sourcePrefix} for ${backupUserId} ` +
          `(${err instanceof Error ? err.message : String(err)}) — leaving source bytes`,
      );
      return false;
    }
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

  /**
   * Deletes one user's backup bytes from S3 (manifest + originals, every key
   * under the located prefix). Resolves live users by DB row and deleted users
   * by S3 scan via locateBackup; an empty prefix reads as 404 (no backup), S3
   * outages as 503. Never touches DB rows — the user/assets/files stay, only
   * S3 bytes go. Deleting a live user's backup is allowed (the row then reads
   * exists:false; the next backup recreates it).
   */
  async deleteBackup(emailOrId: string): Promise<DeleteBackupResult> {
    await this.ensureStorage();
    let located: { prefix: string; manifestObjectKey: string; userId: string };
    try {
      located = await this.locateBackup(emailOrId);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }
    let keys: string[];
    try {
      keys = await this.s3.listKeys(located.prefix);
    } catch {
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }
    if (keys.length === 0) throw new NotFoundException(`No backup found for ${emailOrId}`);
    const email = await this.readDeleteBackupEmail(located);
    try {
      await this.s3.deleteKeys(keys);
    } catch {
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }
    this.logger.log(
      `Deleted backup ${located.prefix} for user ${located.userId} (${keys.length} object(s))`,
    );
    return { userId: located.userId, email, prefix: located.prefix, deletedObjects: keys.length };
  }

  /**
   * Backup-time email for a located backup: the manifest's emailAtBackup when
   * readable, else the email parsed back out of the located prefix (identical
   * except for a pending email-change rename, where the manifest wins). Never
   * throws: readManifest tags every failure and the prefix fallback is defined
   * in practice (located prefixes are always backupPrefix-built or dir-parsed).
   */
  private async readDeleteBackupEmail(located: {
    prefix: string;
    manifestObjectKey: string;
    userId: string;
  }): Promise<string> {
    const read = await this.readManifest(located.manifestObjectKey);
    if ('manifest' in read) return read.manifest.emailAtBackup;
    return this.prefixIdentity(located).emailAtBackup ?? located.userId;
  }

  async backupStatus(emailOrId: string): Promise<BackupStatus> {
    await this.ensureStorage();
    let located;
    try {
      located = await this.locateBackup(emailOrId);
    } catch (err) {
      if (err instanceof NotFoundException) return { exists: false };
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }
    return this.readBackupStatus(located);
  }

  /**
   * Manifest fetch + parse shared by backupStatus (per-user probe) and
   * backupOverview (batch path). Takes an already-resolved location — no
   * ensureBucket, no locateBackup LIST scan — so the overview can reuse its
   * single base listing and one hoisted ensureBucket. S3-down still throws
   * 503 (no partial table); a missing manifest reads as exists:false.
   */
  private async readBackupStatus(located: {
    prefix: string;
    manifestObjectKey: string;
    userId: string;
  }): Promise<BackupStatus> {
    let raw: Buffer;
    try {
      raw = await this.s3.getBuffer(located.manifestObjectKey);
    } catch (err) {
      if (isNotFound(err)) return { exists: false };
      const name = (err as { name?: string }).name ?? 'Unknown';
      try {
        await this.s3.headObject(located.manifestObjectKey);
      } catch (headErr) {
        if (isNotFound(headErr)) return { exists: false };
        throw new ServiceUnavailableException('Backup storage (S3) unreachable');
      }
      this.logger.warn(
        `Backup manifest at ${located.manifestObjectKey} unreadable (${name}) — ` +
          'object exists, reporting degraded status',
      );
      return { exists: true, degraded: 'unreadable', ...this.prefixIdentity(located) };
    }
    let manifest: UserBackupManifest;
    try {
      manifest = userBackupManifestSchema.parse(JSON.parse(raw.toString('utf-8')));
    } catch (err) {
      // never log the payload — the manifest carries the user's passwordHash
      const name = (err as { name?: string }).name ?? 'Unknown';
      this.logger.warn(
        `Backup manifest at ${located.manifestObjectKey} failed validation (${name}) — ` +
          'reporting degraded status',
      );
      return { exists: true, degraded: 'corrupt', ...this.manifestIdentity(raw, located) };
    }
    // Legacy manifests embed derivative rows — report original-only counts so a
    // pre-fix backup reads the same as the bytes a new backup would upload.
    const originalFiles = manifest.files.filter((f) => !isDerivativeStorageKey(f.storageKey));
    return {
      exists: true,
      userId: manifest.userId,
      emailAtBackup: manifest.emailAtBackup,
      role: manifest.user.role,
      backedUpAt: manifest.backedUpAt,
      files: originalFiles.length,
      assets: manifest.assets.length,
      albums: manifest.albums.length,
      shares: manifest.shares.length,
      persons: manifest.persons.length,
    };
  }

  /**
   * Admin backups-table overview: live users plus orphan (deleted-user) S3 prefixes.
   * Live rows join the DB asset count with a manifest snapshot (`deleted: false`);
   * orphan rows are S3-only (`deleted: true`, `totalAssets: 0`, identity from the
   * manifest/prefix with role fallback `user`). Manifest-less prefixes are skipped
   * at debug. S3-down throws 503 via the hoisted ensureBucket, the base listing,
   * or any manifest read (no partial table) so a red table never masquerades as
   * "nobody backed up".
   *
   * Email reconciliation: a deleted account's backup whose manifest email matches
   * a live account is reported as sub-row material in that live row's
   * `legacyBackups` (with its own merge timestamp) instead of showing as an
   * orphan — never as the main row's status, even when the live account has no
   * backup of its own. Main-row precedence per live user: exact own manifest,
   * then a stale same-userId prefix (email-change leftover), then the exact own
   * prefix as exists:false. Previous-account snapshots (different userId) are
   * never the main row.
   *
   * ponytail: O(users + prefixes) manifest GETs + one base listKeys + one
   * ensureBucket — fine for personal-library scale (tens of users); upgrade path
   * is batched getBuffers when user counts grow. Delimiter-style listing skipped:
   * the S3 wrapper exposes only full-prefix listKeys (no Delimiter/CommonPrefixes
   * path), so prefix-only enumeration would need a new op + fake parity.
   */
  async backupOverview(): Promise<BackupOverviewRow[]> {
    const users = await this.users.find({ order: { email: 'ASC' } });
    const liveIds = new Set(users.map((u) => u.id));
    const liveByEmail = new Set(users.map((u) => normalizeEmail(u.email)));
    const totalByUser = new Map<string, number>();
    if (users.length > 0) {
      const ids = users.map((u) => u.id);
      const counts = await this.assets
        .createQueryBuilder('a')
        .select('a."userId"', 'userId')
        .addSelect('COUNT(*)', 'count')
        .where('a."userId" IN (:...ids)', { ids })
        .groupBy('a."userId"')
        .getRawMany<{ userId: string; count: string }>();
      for (const row of counts) totalByUser.set(row.userId, Number(row.count));
    }
    await this.ensureStorage();
    let base: string;
    let keys: string[];
    try {
      base = resolveBackupPrefix();
      keys = await this.s3.listKeys(base);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }

    // One location per manifest-bearing prefix dir. A dir without a manifest is
    // unusable here (no counts/email), so it never participates.
    const dirs = this.manifestDirs(keys, base);

    // Exact live prefixes are always probed even when the listing omitted them —
    // the DB row is authoritative for the current email layout. The promise cache
    // keeps one GET per manifest key when a live prefix is also in `dirs`.
    const exactLocations = users.map((u) => ({
      prefix: backupPrefix(u.email, u.id),
      manifestObjectKey: manifestKey(u.email, u.id),
      userId: u.id,
    }));
    const statusPromises = new Map<string, Promise<BackupStatus>>();
    const readStatus = (loc: {
      prefix: string;
      manifestObjectKey: string;
      userId: string;
    }): Promise<BackupStatus> => {
      const cached = statusPromises.get(loc.prefix);
      if (cached) return cached;
      const pending = this.readBackupStatus(loc);
      statusPromises.set(loc.prefix, pending);
      return pending;
    };
    try {
      await Promise.all([
        ...dirs.map((dir) => readStatus(dir)),
        ...exactLocations.map((loc) => readStatus(loc)),
      ]);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }

    const snapshotsByUser = new Map<string, BackupSnapshot[]>();
    const prefixEmailByPrefix = new Map<string, string>();
    for (const dir of dirs) {
      const status = await readStatus(dir);
      if (!status.exists) continue;
      prefixEmailByPrefix.set(dir.prefix, dir.email);
      const snapshot = snapshotFromStatus(dir.userId, dir.email, dir.prefix, status);
      const list = snapshotsByUser.get(dir.userId) ?? [];
      list.push(snapshot);
      snapshotsByUser.set(dir.userId, list);
    }
    // One snapshot per source account: stale email-change prefixes for the same
    // userId are fallback candidates, never separate rows.
    const newestByUser = new Map<string, BackupSnapshot>();
    for (const [userId, list] of snapshotsByUser) {
      newestByUser.set(userId, pickNewest(list));
    }

    const mergedAtByTarget = new Map<string, Map<string, string>>();
    if (liveIds.size > 0) {
      const ledger = await this.backupMerges.find({ where: { targetUserId: In([...liveIds]) } });
      for (const entry of ledger) {
        const mergedAt = entry.mergedAt.toISOString();
        const bySource = mergedAtByTarget.get(entry.targetUserId) ?? new Map<string, string>();
        bySource.set(entry.backupUserId, mergedAt);
        mergedAtByTarget.set(entry.targetUserId, bySource);
      }
    }

    const exactByUser = new Map(users.map((u, i) => [u.id, exactLocations[i]!]));
    const liveRows: BackupOverviewRow[] = [];
    for (const user of users) {
      const exactLoc = exactByUser.get(user.id)!;
      const exactStatus = await readStatus(exactLoc);
      const exactSnapshot = snapshotFromStatus(user.id, user.email, exactLoc.prefix, exactStatus);
      const staleOwn = (snapshotsByUser.get(user.id) ?? []).filter(
        (snapshot) => snapshot.prefix !== exactLoc.prefix,
      );
      const userEmail = normalizeEmail(user.email);
      const previousAccounts: BackupSnapshot[] = [];
      for (const [sourceId, snapshot] of newestByUser) {
        if (sourceId === user.id || liveIds.has(sourceId)) continue;
        // A corrupt/mismatched manifest can claim a live user's id; never surface a
        // live account's own backup as another account's previous snapshot.
        if (liveIds.has(snapshot.userId)) continue;
        if (normalizeEmail(snapshot.emailAtBackup) !== userEmail) continue;
        previousAccounts.push(snapshot);
      }
      previousAccounts.sort((a, b) => timeOf(b.backedUpAt) - timeOf(a.backedUpAt));

      // Main-row status is never a previous-account snapshot: the exact own prefix
      // when it exists; otherwise the newest stale same-userId prefix (email-change
      // leftover); otherwise the exact own prefix reads as exists:false.
      let primary = exactSnapshot;
      if (!exactStatus.exists && staleOwn.length > 0) {
        primary = pickNewest(staleOwn);
      }
      const ledger = mergedAtByTarget.get(user.id);
      const withMergedAt = (snapshot: BackupSnapshot): BackupSnapshot => {
        const mergedAt = ledger?.get(snapshot.userId);
        return mergedAt === undefined ? { ...snapshot } : { ...snapshot, mergedAt };
      };
      // Every email-matched previous account (different userId, source not live) is
      // sub-row material, newest first — even when the live account has no own
      // backup. Same-userId stale prefixes are own-account leftovers, not "previous
      // accounts", so they never land here.
      const row = buildBackupOverviewRow(
        user,
        totalByUser.get(user.id) ?? 0,
        {
          exists: primary.exists,
          userId: primary.userId,
          emailAtBackup: primary.emailAtBackup,
          backedUpAt: primary.backedUpAt ?? undefined,
          files: primary.files,
          assets: primary.assets,
          albums: primary.albums,
          shares: primary.shares,
          persons: primary.persons,
          ...(primary.degraded !== undefined ? { degraded: primary.degraded } : {}),
        },
        previousAccounts.map(withMergedAt),
      );
      if (normalizeEmail(primary.emailAtBackup) !== userEmail) {
        row.emailAtBackup = primary.emailAtBackup;
      }
      liveRows.push(row);
    }

    const orphanRows: BackupOverviewRow[] = [];
    for (const [sourceId, snapshot] of newestByUser) {
      if (liveIds.has(sourceId) || liveIds.has(snapshot.userId)) continue;
      if (liveByEmail.has(normalizeEmail(snapshot.emailAtBackup))) continue;
      const prefixEmail = prefixEmailByPrefix.get(snapshot.prefix) ?? snapshot.emailAtBackup;
      // Read the original status (cached) so manifest role/degraded flags survive
      // the snapshot projection — orphans have no live user row to supply them.
      const status = await readStatus({
        prefix: snapshot.prefix,
        manifestObjectKey: `${snapshot.prefix}manifest.json`,
        userId: sourceId,
      });
      orphanRows.push(buildOrphanBackupOverviewRow(prefixEmail, sourceId, status, snapshot.prefix));
    }

    // One non-terminal run per user: the admin page uses it to resume the spinner and the
    // per-file counters immediately after a reload (the run ledger outlives the browser).
    const activeRuns = await this.runs.find({
      where: { state: In(['running', 'paused', 'finalizing']) },
      order: { startedAt: 'DESC' },
    });
    const activeByUser = new Map<string, BackupRun>();
    for (const run of activeRuns) {
      if (!activeByUser.has(run.userId)) activeByUser.set(run.userId, run);
    }
    const all = [...liveRows, ...orphanRows].map((row) => {
      const run = activeByUser.get(row.userId);
      return run === undefined
        ? row
        : { ...row, activeRun: { id: run.id, kind: run.kind, state: run.state } };
    });
    all.sort((a, b) => a.email.localeCompare(b.email) || a.userId.localeCompare(b.userId));
    return all;
  }

  /**
   * Live per-file snapshot of the latest backup run for one user. Unknown users throw like
   * startBackup; known users with no run yet get an idle zero snapshot.
   */
  async getBackupProgress(emailOrId: string): Promise<BackupProgress> {
    const user = await this.findUser(emailOrId);
    if (!user) throw new NotFoundException(`No user for ${emailOrId}`);
    const run = await this.runs.findOne({
      where: { userId: user.id, kind: 'backup' },
      order: { startedAt: 'DESC' },
    });
    if (!run) {
      const now = new Date().toISOString();
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
      };
    }
    return {
      userId: user.id,
      inProgress: run.state === 'running' || run.state === 'finalizing',
      total: run.totalItems,
      completed: run.completedItems,
      uploaded: run.uploaded,
      skipped: run.skipped,
      currentFile: run.currentFile ?? undefined,
      startedAt: run.startedAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  /**
   * Best-effort identity for a degraded (unreadable) manifest: the userId from
   * the located prefix plus the backup-time email parsed back out of the
   * `<email>__<userId>` folder segment. Counts are omitted — the body never
   * arrived — and backedUpAt is unknowable without the manifest.
   */
  private prefixIdentity(located: { prefix: string; userId: string }): {
    userId: string;
    emailAtBackup?: string;
  } {
    const identity: { userId: string; emailAtBackup?: string } = { userId: located.userId };
    try {
      const base = resolveBackupPrefix();
      const dir =
        base && located.prefix.startsWith(base)
          ? located.prefix.slice(base.length)
          : located.prefix;
      // parseBackupDir strips the folder's trailing slash itself
      const parsed = parseBackupDir(dir);
      if (parsed.userId === located.userId) identity.emailAtBackup = parsed.email;
    } catch {
      // email stays omitted — userId alone still identifies the backup
    }
    return identity;
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
    };
    try {
      const partial = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
      if (typeof partial.userId === 'string' && partial.userId.length > 0) {
        identity.userId = partial.userId;
      }
      if (typeof partial.emailAtBackup === 'string' && partial.emailAtBackup.length > 0) {
        identity.emailAtBackup = partial.emailAtBackup;
      }
      if (typeof partial.backedUpAt === 'string' && partial.backedUpAt.length > 0) {
        identity.backedUpAt = partial.backedUpAt;
      }
    } catch {
      // raw bytes are not JSON at all — prefix-derived identity stands
    }
    return identity;
  }

  // ---------------------------------------------------------------------------------------
  // Per-file transfer ledger: backup/restore items are claimed in small batches, retried
  // independently, and the run finalizes (manifest last, derivatives last) when none remain.
  // ---------------------------------------------------------------------------------------

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
   * Re-drives a failed/paused/cancelled run: every unfinished item goes back to pending with a
   * fresh attempt budget. A completed run is not retryable (start a new restore instead).
   */
  async retryRun(runId: string): Promise<BackupRunStatus> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Backup run not found');
    if (run.state !== 'failed' && run.state !== 'paused' && run.state !== 'cancelled') {
      throw new ConflictException('Backup run is not retryable');
    }
    const otherActive = await this.runs.findOne({
      where: { userId: run.userId, state: In(['running', 'paused', 'finalizing']) },
    });
    if (otherActive && otherActive.id !== run.id) {
      throw new ConflictException('Another backup or restore is running for this user');
    }
    await this.resumeRun(runId);
    return this.getRunStatus(runId);
  }

  async cancelRun(runId: string): Promise<BackupRunStatus> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Backup run not found');
    if (run.state === 'running' || run.state === 'paused') {
      await this.runs.update(runId, {
        state: 'cancelled',
        currentFile: null,
        finishedAt: new Date(),
        updatedAt: new Date(),
      });
    }
    return this.getRunStatus(runId);
  }

  /** One sweeper pass: requeue crashed claims, transfer one batch, finalize finished runs. */
  async runTransfersOnce(ignoreBackoff = false): Promise<number> {
    await this.requeueStuckFinalizing();
    await this.requeueStaleClaims();
    const processed = await this.processBatch(TRANSFER_BATCH_SIZE, null, ignoreBackoff);
    await this.finalizeDueRuns(null);
    return processed;
  }

  /**
   * Synchronous driver used by the public backupUser/restoreUser wrappers (integration tests and
   * callers that cannot poll). Ignores backoff so a retry does not stall the request.
   */
  private async drainRun(runId: string): Promise<void> {
    for (;;) {
      const run = await this.runs.findOne({ where: { id: runId } });
      if (!run) throw new NotFoundException('Backup run not found');
      if (run.state === 'finalizing') {
        await this.finalizeDueRuns(runId);
      } else if (run.state !== 'running') {
        return;
      }
      const processed = await this.processBatch(TRANSFER_BATCH_SIZE, runId, true);
      await this.finalizeDueRuns(runId);
      const after = await this.runs.findOne({ where: { id: runId } });
      if (!after) return;
      if (after.state === 'running' && processed === 0) return;
      if (after.state !== 'running' && after.state !== 'finalizing') return;
    }
  }

  private async assertNoActiveRun(userId: string): Promise<void> {
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
      { runId, state: In(['pending', 'retrying', 'running', 'failed', 'missing']) },
      { state: 'pending', attempts: 0, nextAttemptAt: new Date(), claimedAt: null, error: null },
    );
    await this.runs.update(runId, {
      state: 'running',
      error: null,
      currentFile: null,
      finishedAt: null,
      updatedAt: new Date(),
    });
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

  private completedBackupResult(runId: string): Promise<BackupResult> {
    return this.completedResult<BackupResult>(runId, 'Backup');
  }

  private completedRestoreResult(runId: string): Promise<RestoreResult> {
    return this.completedResult<RestoreResult>(runId, 'Restore');
  }

  private async completedResult<T>(runId: string, label: string): Promise<T> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`${label} run not found`);
    if (run.state === 'completed') return run.result as unknown as T;
    throw new Error(run.error ?? `${label} ${run.state}`);
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

  private async claimItems(
    limit: number,
    onlyRunId: string | null,
    ignoreBackoff: boolean,
  ): Promise<ClaimedBackupItem[]> {
    const due = ignoreBackoff ? '' : 'AND i2."nextAttemptAt" <= now()';
    const result: unknown = await this.dataSource.query(
      `UPDATE "backup_run_items" i
       SET "state" = 'running', "claimedAt" = now(), "attempts" = i."attempts" + 1
       WHERE i."id" IN (
         SELECT i2."id" FROM "backup_run_items" i2
         JOIN "backup_runs" r ON r."id" = i2."runId"
         WHERE r."state" = 'running'
           AND i2."state" IN ('pending', 'retrying')
           ${due}
           AND ($2::uuid IS NULL OR i2."runId" = $2::uuid)
         ORDER BY i2."nextAttemptAt" ASC
         FOR UPDATE OF i2 SKIP LOCKED
         LIMIT $1
       )
       RETURNING i."id" AS "id", i."runId" AS "runId", i."fileId" AS "fileId",
                 i."storageKey" AS "storageKey", i."s3Key" AS "s3Key",
                 i."checksumSha256" AS "checksumSha256", i."mimeType" AS "mimeType",
                 i."attempts" AS "attempts"`,
      [limit, onlyRunId],
    );
    return rowsOf<ClaimedBackupItem>(result);
  }

  private async processBatch(
    limit: number,
    onlyRunId: string | null,
    ignoreBackoff: boolean,
  ): Promise<number> {
    const items = await this.claimItems(limit, onlyRunId, ignoreBackoff);
    if (items.length === 0) return 0;
    const runs = new Map<string, BackupRun>();
    for (const runId of new Set(items.map((item) => item.runId))) {
      const run = await this.runs.findOne({ where: { id: runId } });
      if (run) runs.set(runId, run);
    }
    await Promise.all(
      items.map((item) => {
        const run = runs.get(item.runId);
        return run ? this.transferItem(run, item) : Promise.resolve();
      }),
    );
    return items.length;
  }

  private async transferItem(run: BackupRun, item: ClaimedBackupItem): Promise<void> {
    await this.runs.update(run.id, { currentFile: item.storageKey, updatedAt: new Date() });
    try {
      if (run.kind === 'backup') {
        await this.s3.putFile(
          item.s3Key,
          this.storage.pathFor(item.storageKey),
          item.mimeType ?? undefined,
        );
      } else {
        await this.restoreFile(run, item);
      }
      await this.runItems.delete(item.id);
      await this.bumpRun(run.id, 'uploaded');
    } catch (err) {
      await this.handleTransferError(run, item, err);
    }
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

  private async handleTransferError(
    run: BackupRun,
    item: ClaimedBackupItem,
    err: unknown,
  ): Promise<void> {
    const message = errorMessage(err);
    const code = (err as NodeJS.ErrnoException).code;

    // local storage is full/unwritable: retrying every file is pointless — park the run
    if (code === 'ENOSPC' || code === 'EDQUOT' || code === 'EACCES') {
      await this.runItems.update(item.id, {
        state: 'retrying',
        attempts: 0,
        nextAttemptAt: new Date(),
        claimedAt: null,
        error: message,
      });
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
    const permanent = missing || code === 'ENOENT' || item.attempts >= TRANSFER_MAX_ATTEMPTS;
    if (permanent) {
      await this.runItems.update(item.id, {
        state: missing ? 'missing' : 'failed',
        error: message,
        claimedAt: null,
      });
      await this.bumpRun(run.id, 'failed');
      this.logger.warn(
        `Backup transfer ${missing ? 'missing' : 'failed'} (${run.kind}) file=${item.fileId} ` +
          `run=${run.id}: ${message}`,
      );
      return;
    }

    const delayMs = Math.min(TRANSFER_MAX_BACKOFF_MS, 1000 * 2 ** item.attempts);
    await this.runItems.update(item.id, {
      state: 'retrying',
      nextAttemptAt: new Date(Date.now() + delayMs),
      claimedAt: null,
      error: message,
    });
    this.logger.warn(
      `Backup transfer retry (${run.kind}) file=${item.fileId} attempt=${item.attempts}: ${message}`,
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

  /** Runs with no claimable items left are atomically promoted to finalizing and finished. */
  private async finalizeDueRuns(onlyRunId: string | null): Promise<void> {
    const rows = rowsOf<{ id: string }>(
      await this.dataSource.query(
        `SELECT r."id" FROM "backup_runs" r
       WHERE r."state" = 'running'
         AND NOT EXISTS (
           SELECT 1 FROM "backup_run_items" i
           WHERE i."runId" = r."id" AND i."state" IN ('pending', 'retrying', 'running')
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

  private async finalizeBackupRun(run: BackupRun, manifest: UserBackupManifest): Promise<void> {
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

    // prune stale originals under the new prefix (pre-fix backups uploaded thumbnail bytes)
    try {
      const listed = new Set(await this.s3.listKeys(run.prefix));
      const expected = new Set(
        manifest.files.map((file) =>
          originalKey(run.email!, run.userId, file.id, extOf(file.storageKey)),
        ),
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

    // bytes are all in S3 now: the manifest lands last and is HEAD-verified
    await this.s3.putObject(
      run.manifestKey,
      Buffer.from(JSON.stringify(manifest)),
      'application/json',
    );
    await this.s3.headObject(run.manifestKey);
    await this.deletePrefixesQuietly(run.stalePrefixes ?? [], run.userId);

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
        await this.renameBackupPrefix([finalPrefix], targetPrefix);
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
        await this.deletePrefixesQuietly([run.prefix ?? ''], run.userId);
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

  private async findUser(emailOrId: string): Promise<User | null> {
    // M1: non-UUID email input must never reach the uuid-typed id lookup — Postgres
    // raises 22P02 (500) before the email fallback runs (precedent: assets.service
    // isUUID guard). UUIDs take the by-id fast path, everything else goes email-only.
    if (isUUID(emailOrId)) {
      const byId = await this.users.findOne({ where: { id: emailOrId } });
      if (byId) return byId;
    }
    return this.users.findOne({ where: { email: normalizeEmail(emailOrId) } });
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
    const read = await this.readManifest(manifestObjectKey);
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
   * Lists every stale same-userId prefix (old emails) excluding the current one,
   * via the shared findPrefixesForUserId helper over a base listing.
   */
  private async findStalePrefixesForUser(userId: string, currentPrefix: string): Promise<string[]> {
    const base = resolveBackupPrefix();
    const keys = await this.s3.listKeys(base);
    return findPrefixesForUserId(keys, base, userId).filter(
      (prefix: string) => prefix !== currentPrefix,
    );
  }

  /** Maps an S3 ensureBucket failure to the documented 503. */
  private async ensureStorage(): Promise<void> {
    try {
      await this.s3.ensureBucket();
    } catch {
      throw new ServiceUnavailableException('Backup storage (S3) unreachable');
    }
  }

  /**
   * Best-effort delete of whole backup prefixes: list, delete, log. A failure
   * leaves the prefix as an orphan for the next backup sweep — never throws.
   */
  private async deletePrefixesQuietly(prefixes: string[], userId: string): Promise<void> {
    for (const prefix of prefixes) {
      try {
        const oldKeys = await this.s3.listKeys(prefix);
        if (oldKeys.length > 0) await this.s3.deleteKeys(oldKeys);
        this.logger.log(`Deleted old backup prefix ${prefix} for user ${userId}`);
      } catch (err) {
        this.logger.warn(
          `Failed to delete old backup prefix ${prefix} (${errorName(err)}) — leaving orphan`,
        );
      }
    }
  }

  /**
   * Lazy S3 rename: server-side copy-forward of every stale prefix into the
   * current prefix (manifests skipped — rewritten fresh after the upload loop).
   * Sequential per prefix; copyPrefix logs the per-prefix copy/skip counts.
   */
  private async renameBackupPrefix(stalePrefixes: string[], newPrefix: string): Promise<void> {
    for (const stale of stalePrefixes) {
      await this.s3.copyPrefix(stale, newPrefix);
      this.logger.log(`Renamed backup prefix ${stale} -> ${newPrefix}`);
    }
  }

  /**
   * Fetches + schema-validates one backup manifest. Never throws: a missing
   * object, unreadable bytes or corrupt JSON/schema each come back tagged (with
   * the raw cause for callers that log the error name), so every caller keeps
   * its own mapping (null, 404/503, 422).
   */
  private async readManifest(key: string): Promise<ManifestReadResult> {
    let raw: Buffer;
    try {
      raw = await this.s3.getBuffer(key);
    } catch (err) {
      return { error: isNotFound(err) ? 'missing' : 'unreadable', cause: err };
    }
    try {
      return { manifest: userBackupManifestSchema.parse(JSON.parse(raw.toString('utf-8'))) };
    } catch (err) {
      return { error: 'corrupt', cause: err };
    }
  }

  /**
   * Streams S3 objects into local storage through a scratch dir (originals can
   * be gigabytes — never buffered). `skipExisting` leaves already-present keys
   * alone (retry-friendly merge); restore always writes because rows are fresh.
   */
  private async downloadToStorage(
    items: { id: string; storageKey: string; sourceKey: string }[],
    tmpPrefix: string,
    skipExisting = false,
  ): Promise<void> {
    const tmpRoot = await mkdtemp(join(tmpdir(), tmpPrefix));
    try {
      for (const item of items) {
        if (skipExisting && (await this.storage.exists(item.storageKey))) continue;
        const tmp = join(tmpRoot, `${item.id}.${randomUUID()}.tmp`);
        await this.s3.downloadToFile(item.sourceKey, tmp);
        await this.storage.save(item.storageKey, tmp);
      }
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  }

  /**
   * Resolves the S3 prefix for a user: exact DB-derived prefix when its manifest
   * exists (email-first layout), else a single S3 scan choosing the newest
   * matching manifest. A live user matches either a same-userId stale prefix
   * (email-change leftover) or an email-matched previous account (deleted and
   * re-created) — both are legitimate sources for status/delete/restore. When no
   * candidate exists the exact location is returned so callers can report
   * exists:false instead of erroring. Non-live input (deleted user) matches the
   * newest manifest by normalized prefix email or userId suffix. Suffix matching
   * splits folder names on the LAST `__` (emails may contain `__`; UUIDs never do).
   */
  private async locateBackup(
    emailOrId: string,
  ): Promise<{ prefix: string; manifestObjectKey: string; userId: string }> {
    const user = await this.findUser(emailOrId);
    const base = resolveBackupPrefix();
    if (user) {
      const exact = {
        prefix: backupPrefix(user.email, user.id),
        manifestObjectKey: manifestKey(user.email, user.id),
        userId: user.id,
      };
      try {
        await this.s3.headObject(exact.manifestObjectKey);
        return exact;
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
      const keys = await this.s3.listKeys(base);
      const wantedEmail = normalizeEmail(user.email);
      const candidates: { dir: BackupDirLocation; status: BackupStatus }[] = [];
      for (const dir of this.manifestDirs(keys, base)) {
        if (dir.userId !== user.id && normalizeEmail(dir.email) !== wantedEmail) continue;
        const status = await this.readBackupStatus(dir);
        if (!status.exists) continue;
        // Manifest emailAtBackup is authoritative; prefix email covers degraded.
        if (dir.userId !== user.id) {
          const backupEmail = normalizeEmail(status.emailAtBackup ?? dir.email);
          if (backupEmail !== wantedEmail) continue;
        }
        candidates.push({ dir, status });
      }
      if (candidates.length === 0) return exact;
      return this.newestLocated(candidates);
    }
    if (emailOrId.includes('@')) {
      const keys = await this.s3.listKeys(base);
      const wantEmail = normalizeEmail(emailOrId);
      const emailCandidates: { dir: BackupDirLocation; status: BackupStatus }[] = [];
      for (const dir of this.manifestDirs(keys, base)) {
        // Manifest email is authoritative (a pending email-change rename can leave
        // the prefix dir on the old address); fall back to the prefix email.
        const status = await this.readBackupStatus(dir);
        if (!status.exists) continue;
        if (normalizeEmail(status.emailAtBackup ?? dir.email) !== wantEmail) continue;
        emailCandidates.push({ dir, status });
      }
      if (emailCandidates.length === 0) {
        throw new NotFoundException(`No backup found for ${emailOrId}`);
      }
      // Prefer readable manifests; all-unreadable still resolves the prefix so
      // deleteBackup can remove the bytes (old first-manifest behavior).
      const readable = emailCandidates.filter((candidate) => candidate.status.exists);
      return this.newestLocated(readable.length > 0 ? readable : emailCandidates);
    }
    const candidates = await this.locateBackupByUserId(emailOrId);
    if (candidates.length === 0) throw new NotFoundException(`No backup found for ${emailOrId}`);
    // Prefer readable manifests; all-unreadable still resolves the prefix so
    // deleteBackup can remove the bytes (old first-manifest behavior).
    const readable = candidates.filter((candidate) => candidate.status.exists);
    return this.newestLocated(readable.length > 0 ? readable : candidates);
  }

  /**
   * Every manifest-bearing backup dir owned by one userId (stale email-change
   * prefixes included), with its manifest status, from a single base listing.
   * Shared by the merge source scan and locateBackup's non-live userId branch.
   */
  private async locateBackupByUserId(
    userId: string,
  ): Promise<{ dir: BackupDirLocation; status: BackupStatus }[]> {
    const base = resolveBackupPrefix();
    const keys = await this.s3.listKeys(base);
    const candidates: { dir: BackupDirLocation; status: BackupStatus }[] = [];
    for (const dir of this.manifestDirs(keys, base)) {
      if (dir.userId !== userId) continue;
      candidates.push({ dir, status: await this.readBackupStatus(dir) });
    }
    return candidates;
  }

  /** Every manifest-bearing backup dir under `base`, one per prefix. */
  private manifestDirs(keys: string[], base: string): BackupDirLocation[] {
    const dirs: BackupDirLocation[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
      if (!key.startsWith(base) || !key.endsWith('/manifest.json')) continue;
      const rest = key.slice(base.length);
      const slash = rest.indexOf('/');
      if (slash <= 0) continue;
      const dir = rest.slice(0, slash);
      const prefix = `${base}${dir}/`;
      if (seen.has(prefix)) continue;
      seen.add(prefix);
      let parsed: { email: string; userId: string };
      try {
        parsed = parseBackupDir(dir);
      } catch {
        continue;
      }
      dirs.push({ prefix, manifestObjectKey: key, email: parsed.email, userId: parsed.userId });
    }
    return dirs;
  }

  private newestLocated(candidates: { dir: BackupDirLocation; status: BackupStatus }[]): {
    prefix: string;
    manifestObjectKey: string;
    userId: string;
  } {
    const best = pickNewest(
      candidates.map((candidate) => ({
        dir: candidate.dir,
        backedUpAt: candidate.status.backedUpAt,
      })),
    );
    return {
      prefix: best.dir.prefix,
      manifestObjectKey: best.dir.manifestObjectKey,
      userId: best.dir.userId,
    };
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
   * family so a merge never collides with a retained restore record.
   *
   * Every jobId carries a per-run tag: a previous restore's records stay retained in
   * Redis (completed; removeOnComplete is unset for every family but metadata) and
   * BullMQ silently rejects any add whose jobId already exists — without the tag, a
   * later restore of the same user (delete → restore again) enqueues nothing while
   * still reporting success. Both passes of one run share the tag, so their
   * double-enqueue keeps deduping.
   */
  private async reenqueueDerivatives(
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
        await this.bullMq.enqueue(
          'process-metadata',
          'process-metadata',
          { assetId: asset.id, fileId: asset.fileId, userId, kind: asset.kind },
          {
            jobId: `metadata-${mode}-${runTag}-${asset.id}`,
            removeOnComplete: true,
          },
        );
        totals.metadata += pass === 0 ? 1 : 0;
        await this.bullMq.enqueueThumbnails(
          asset.id,
          asset.fileId,
          userId,
          `thumb-${mode}-${runTag}`,
        );
        totals.thumbnails += pass === 0 ? 4 : 0;
        if (asset.kind === 'video') {
          await this.bullMq.enqueueVideo(asset.id, asset.fileId, userId, {
            jobId: `video-${mode}-${runTag}-${asset.id}`,
          });
          totals.videos += pass === 0 ? 1 : 0;
        }
        if (asset.kind === 'photo') {
          await this.bullMq.enqueue(
            'process-faces',
            'process-faces',
            { assetId: asset.id, fileId: asset.fileId, userId, reason: mode },
            { jobId: `face-${mode}-${runTag}-${asset.id}` },
          );
          totals.faces += pass === 0 ? 1 : 0;
          await this.bullMq.enqueue(
            'process-embeddings',
            'process-embeddings',
            { assetId: asset.id, fileId: asset.fileId, userId, reason: mode },
            { jobId: `embed-${mode}-${runTag}-${asset.id}-${SEARCH_EMBEDDING_MODEL}` },
          );
          await this.bullMq.enqueue(
            'process-detect',
            'process-detect',
            { assetId: asset.id, fileId: asset.fileId, userId, reason: mode },
            { jobId: `detect-${mode}-${runTag}-${asset.id}` },
          );
          totals.ai += pass === 0 ? 2 : 0;
        }
      }
    }
    await this.bullMq.enqueue(
      'process-faces-cluster',
      'cluster',
      { userId, reason: mode },
      { jobId: `cluster-${userId}-${mode}-${Date.now()}` },
    );
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
