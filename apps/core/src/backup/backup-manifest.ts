import { extname } from 'path';
import type { Album, Asset, FileRecord, Person, Share, User } from '../database/entities';
import { timeOf, unionById } from './backup-overview.builder';
import type { PreviousFileEntry, UserBackupManifest } from './backup.types';

export function extOf(storageKey: string): string {
  return extname(storageKey).slice(1);
}

// Thumbnails register with purpose='original' (FileRecord only has
// 'original'|'transcode') but live under derivatives/thumbnails/..., so purpose
// alone cannot isolate original bytes — storageKey prefix is the arbiter.
export function isDerivativeStorageKey(storageKey: string): boolean {
  return storageKey.startsWith('derivatives/');
}

// Shared row→manifest projections: a backup and backup adoption (merge) must
// emit byte-identical entries for the same DB row, so both go through here.
export function fileToManifestEntry(f: FileRecord): UserBackupManifest['files'][number] {
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

export function assetToManifestEntry(a: Asset): UserBackupManifest['assets'][number] {
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

export function albumToManifestEntry(a: Album): UserBackupManifest['albums'][number] {
  return {
    id: a.id,
    userId: a.userId,
    name: a.name,
    description: a.description,
    hiddenFromTimeline: a.hiddenFromTimeline,
  };
}

export function shareToManifestEntry(s: Share): UserBackupManifest['shares'][number] {
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

export function personToManifestEntry(p: Person): UserBackupManifest['persons'][number] {
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    clusterLabel: p.clusterLabel,
    faceCount: p.faceCount,
  };
}

export function userToManifest(u: User): UserBackupManifest['user'] {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    passwordHash: u.passwordHash,
    displayName: u.displayName,
    tokensValidAfter: u.tokensValidAfter?.toISOString() ?? null,
  };
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
