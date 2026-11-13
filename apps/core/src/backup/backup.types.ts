import { z } from 'zod';
import type { BackupRunState } from '../database/entities/backup-run.entity';

export const fileManifestSchema = z.object({
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

export const assetManifestSchema = z.object({
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

export const albumManifestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  // added after manifestVersion 1 shipped: default keeps pre-fix backups restorable (they
  // restore as visible, which is what they did before) instead of rejecting them
  hiddenFromTimeline: z.boolean().default(false),
});

export const albumAssetManifestSchema = z.object({
  albumId: z.string().uuid(),
  assetId: z.string().uuid(),
});

export const shareManifestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  kind: z.enum(['asset', 'album']),
  assetId: z.string().uuid().nullable(),
  albumId: z.string().uuid().nullable(),
  token: z.string(),
  expiresAt: z.string().nullable(),
});

export const personManifestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().nullable(),
  clusterLabel: z.string().nullable(),
  faceCount: z.number().int(),
  // ponytail: coverFaceId dropped — it points at faces rows (regenerated with new
  // UUIDs), so restore always stores NULL and recluster assigns fresh covers
});

export const userManifestSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['user', 'admin']),
  passwordHash: z.string(),
  displayName: z.string(),
  tokensValidAfter: z.string().nullable(),
});

export const userBackupManifestSchema = z.object({
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
export type ManifestReadResult =
  | { manifest: UserBackupManifest }
  | { error: 'missing' | 'unreadable' | 'corrupt'; cause?: unknown };

/** Previous-manifest file entry used by the incremental upload gate. */
export interface PreviousFileEntry {
  checksumSha256: string;
  sizeBytes: number;
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

export interface ClaimedBackupItem {
  id: string;
  runId: string;
  fileId: string;
  storageKey: string;
  s3Key: string;
  checksumSha256: string | null;
  mimeType: string | null;
  attempts: number;
}

/** The slice of a BullMQ Job the consumer needs; keeps the handler unit-testable. */
export interface TransferJobLike {
  data: unknown;
  attemptsMade: number;
  opts: { attempts?: number };
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
