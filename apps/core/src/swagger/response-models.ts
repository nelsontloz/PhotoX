import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import type {
  BackupOverviewRow,
  BackupProgress,
  BackupRunStatus,
  BackupStatus,
  BackupResult,
  RestoreResult,
  DeleteBackupResult,
  MergeBackupResult,
  BackupSnapshot,
} from '../backup/user-backup.service';
import type {
  AdminAssetCountsResponse,
  AdminLibraryCounts,
  AdminLibraryStatsResponse,
  AdminLibraryStorageMonth,
  AdminLibraryUploadsWeek,
  AdminReprocessThumbnailsResponse,
  AdminUserBackupSync,
  AdminUserDeleteResponse,
  AdminUserDeleteState,
  AdminUserDeleteStatus,
  AdminUserListResponse,
  AdminUserRow,
  AdminUserUpdateResponse,
  AlbumDto,
  AlbumListResponse,
  Asset,
  AssetDetectionDto,
  AssetDetectionsResponse,
  AssetFailureCounts,
  AssetLayoutIndex,
  AssetLayoutMonth,
  AssetLayoutPage,
  AssetListResponse,
  AssetShareDto,
  AssetThumbnail,
  AuthResponse,
  AlbumShareDto,
  DetectionBox,
  FaceDetectionSettings,
  FaceDto,
  FileExistsCheckHit,
  FileExistsCheckResponse,
  PersonDto,
  PersonListResponse,
  PublicAlbumAssetsResponse,
  PublicAlbumShareResponse,
  PublicAssetShareResponse,
  PublicShareAsset,
  PublicShareInfo,
  RegistrationSettings,
  SearchResponse,
  ShareListResponse,
  ShareListItem,
  StorageQuotaResponse,
  UploadCompleteResponse,
  UploadSessionCreated,
  UploadSessionStatusResponse,
  User,
  UserDeletePhase,
} from '@photox/shared-types';

/**
 * OpenAPI response components for every 2xx JSON body. Each class implements the
 * `@photox/shared-types` interface it mirrors, so a wire-contract change fails `typecheck`
 * instead of silently drifting out of the document. Error bodies are not modelled here.
 */

// --- shared primitives -------------------------------------------------------

export class UserModel implements User {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String, format: 'email' })
  email!: string;

  @ApiProperty({ enum: ['user', 'admin'] })
  role!: 'user' | 'admin';

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class AuthResponseModel implements AuthResponse {
  @ApiProperty({ type: String })
  accessToken!: string;

  @ApiProperty({ type: Number, description: 'Seconds until the access token expires' })
  accessTokenExpiresIn!: number;

  @ApiProperty({ type: String })
  refreshToken!: string;

  @ApiProperty({ type: () => UserModel })
  user!: UserModel;
}

export class RegistrationSettingsModel implements RegistrationSettings {
  @ApiProperty({ type: Boolean })
  enabled!: boolean;
}

export class OkResponseModel {
  @ApiProperty({ type: Boolean, example: true })
  ok!: boolean;
}

export class RunIdResponseModel {
  @ApiProperty({ type: String, format: 'uuid' })
  runId!: string;
}

export class DetectionBoxModel implements DetectionBox {
  @ApiProperty({ type: Number })
  x!: number;

  @ApiProperty({ type: Number })
  y!: number;

  @ApiProperty({ type: Number })
  w!: number;

  @ApiProperty({ type: Number })
  h!: number;
}

// --- assets ------------------------------------------------------------------

export class AssetThumbnailModel implements AssetThumbnail {
  @ApiProperty({ type: String, example: 'sm' })
  size!: string;

  @ApiProperty({ type: String })
  fileId!: string;

  @ApiProperty({ type: Number })
  width!: number;

  @ApiProperty({ type: Number })
  height!: number;

  @ApiProperty({ type: Number })
  bytes!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class FaceModel implements FaceDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  assetId!: string;

  @ApiProperty({ type: () => DetectionBoxModel })
  box!: DetectionBoxModel;

  @ApiProperty({ type: Number })
  confidence!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  personId?: string | null;
}

export class AssetModel implements Asset {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ enum: ['photo', 'video'] })
  kind!: 'photo' | 'video';

  @ApiProperty({ type: String })
  fileId!: string;

  @ApiProperty({
    type: String,
    description: 'Cache token for GET /api/v1/assets/:id/content; pass back as ?v=',
  })
  contentVersion!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  uploadedAt!: string;

  @ApiProperty({ type: Boolean })
  isTrashed!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  trashedAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  takenAt!: string | null;

  @ApiProperty({ type: Boolean })
  favorite!: boolean;

  @ApiProperty({ type: String, nullable: true })
  mimeType!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  sizeBytes!: number | null;

  @ApiProperty({ type: String, nullable: true })
  originalName!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  width!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  height!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  durationSeconds!: number | null;

  @ApiProperty({ type: String, nullable: true })
  cameraMake!: string | null;

  @ApiProperty({ type: String, nullable: true })
  cameraModel!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lensModel!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  orientation!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  iso!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  fNumber!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  exposureTime!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  focalLength!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  latitude!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  longitude!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  altitude!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  fps!: number | null;

  @ApiProperty({ type: String, nullable: true })
  codec!: string | null;

  @ApiProperty({ type: Boolean, nullable: true })
  hasAudio!: boolean | null;

  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ enum: ['pending', 'ready', 'failed'] })
  metadataStatus!: 'pending' | 'ready' | 'failed';

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  metadataExtractedAt!: string | null;

  @ApiProperty({ enum: ['pending', 'ready', 'failed'], nullable: true })
  transcodeStatus!: 'pending' | 'ready' | 'failed' | null;

  @ApiProperty({ type: String, nullable: true })
  transcodeFileId!: string | null;

  @ApiProperty({ enum: ['pending', 'ready', 'failed'], nullable: true })
  thumbnailStatus!: 'pending' | 'ready' | 'failed' | null;

  @ApiPropertyOptional({ type: [AssetThumbnailModel] })
  thumbnails?: AssetThumbnailModel[];

  @ApiProperty({ enum: ['pending', 'ready', 'failed'], nullable: true })
  faceStatus!: 'pending' | 'ready' | 'failed' | null;

  @ApiProperty({ type: Number, nullable: true })
  faceCount!: number | null;

  @ApiPropertyOptional({ type: [FaceModel] })
  faces?: FaceModel[];
}

export class AssetListResponseModel implements AssetListResponse {
  @ApiProperty({ type: [AssetModel] })
  items!: AssetModel[];

  @ApiProperty({ type: Number, description: 'Whole-match count, not a page size' })
  total!: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'null on the last page' })
  nextCursor?: string | null;
}

export class SearchResponseModel implements SearchResponse {
  @ApiProperty({ type: [AssetModel] })
  items!: AssetModel[];

  @ApiProperty({ type: Number })
  total!: number;
}

export class AssetDetectionModel implements AssetDetectionDto {
  @ApiProperty({ type: String })
  label!: string;

  @ApiProperty({ type: Number })
  confidence!: number;

  @ApiProperty({ type: () => DetectionBoxModel, description: 'Original-image pixel coordinates' })
  box!: DetectionBoxModel;
}

export class AssetDetectionsResponseModel implements AssetDetectionsResponse {
  @ApiProperty({ type: [AssetDetectionModel] })
  detections!: AssetDetectionModel[];
}

// --- timeline ----------------------------------------------------------------

export class AssetLayoutItemModel {
  @ApiProperty({ type: String })
  t!: string;

  @ApiProperty({ type: Number })
  w!: number;

  @ApiProperty({ type: Number })
  h!: number;
}

export class AssetLayoutMonthModel implements AssetLayoutMonth {
  @ApiProperty({ type: String, description: 'Local month key, YYYY-MM', example: '2026-11' })
  key!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  from!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  to!: string;

  @ApiProperty({ type: Number })
  count!: number;

  @ApiProperty({ type: String, description: 'Opaque change token: compare for equality only' })
  version!: string;
}

export class AssetLayoutIndexModel implements AssetLayoutIndex {
  @ApiProperty({ type: [AssetLayoutMonthModel] })
  months!: AssetLayoutMonthModel[];
}

export class AssetLayoutPageModel implements AssetLayoutPage {
  @ApiProperty({ type: [AssetLayoutItemModel] })
  items!: AssetLayoutItemModel[];

  @ApiProperty({ type: String, format: 'date-time' })
  from!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  to!: string;

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: String, description: 'Opaque change token: compare for equality only' })
  version!: string;

  @ApiProperty({ type: Number, nullable: true, description: 'Row index inside this window' })
  nextOffset!: number | null;
}

// --- persons -----------------------------------------------------------------

export class PersonModel implements PersonDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  coverFaceId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  clusterLabel!: string | null;

  @ApiProperty({ type: Number })
  faceCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class PersonListResponseModel implements PersonListResponse {
  @ApiProperty({ type: [PersonModel] })
  items!: PersonModel[];

  @ApiProperty({ type: Number, description: 'Whole-match count, not a page size' })
  total!: number;
}

export class PersonClusterResponseModel {
  @ApiProperty({ type: Boolean, example: true })
  queued!: boolean;

  @ApiProperty({ type: String })
  jobId!: string;
}

// --- albums ------------------------------------------------------------------

export class AlbumModel implements AlbumDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: Boolean })
  hiddenFromTimeline!: boolean;

  @ApiProperty({ type: Number })
  assetCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** GET /api/v1/albums — offset-addressed: no cursor, `total` is the whole count. */
export class AlbumListResponseModel implements AlbumListResponse {
  @ApiProperty({ type: [AlbumModel] })
  items!: AlbumModel[];

  @ApiProperty({ type: Number })
  total!: number;
}

/** GET /api/v1/albums/:id/assets — keyset page: `nextCursor` is null on the last page. */
export class AlbumAssetsResponseModel {
  @ApiProperty({ type: [AssetModel] })
  items!: AssetModel[];

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class AddAssetsResponseModel {
  @ApiProperty({ type: Number, description: 'Assets sent in the request' })
  added!: number;
}

// --- shares ------------------------------------------------------------------

export class AssetShareModel implements AssetShareDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: ['asset'] })
  kind!: 'asset';

  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: String })
  token!: string;

  @ApiProperty({ type: String })
  assetId!: string;

  @ApiProperty({ type: String, nullable: true })
  assetFileId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  assetThumbFileId!: string | null;

  @ApiProperty({ enum: ['photo', 'video'], nullable: true })
  assetKind!: 'photo' | 'video' | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class AlbumShareModel implements AlbumShareDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: ['album'] })
  kind!: 'album';

  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: String })
  token!: string;

  @ApiProperty({ type: String })
  albumId!: string;

  @ApiProperty({ type: String })
  albumName!: string;

  @ApiProperty({ type: Number })
  albumAssetCount!: number;

  @ApiProperty({ type: String, nullable: true })
  albumCoverThumbFileId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class AssetShareItemModel implements Omit<AssetShareDto, 'token'> {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: ['asset'] })
  kind!: 'asset';

  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: String })
  assetId!: string;

  @ApiProperty({ type: String, nullable: true })
  assetFileId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  assetThumbFileId!: string | null;

  @ApiProperty({ enum: ['photo', 'video'], nullable: true })
  assetKind!: 'photo' | 'video' | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class AlbumShareItemModel implements Omit<AlbumShareDto, 'token'> {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: ['album'] })
  kind!: 'album';

  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: String })
  albumId!: string;

  @ApiProperty({ type: String })
  albumName!: string;

  @ApiProperty({ type: Number })
  albumAssetCount!: number;

  @ApiProperty({ type: String, nullable: true })
  albumCoverThumbFileId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

@ApiExtraModels(AssetShareItemModel, AlbumShareItemModel)
export class ShareListResponseModel implements ShareListResponse {
  // A share row is one of two disjoint shapes and the raw token is never listed.
  @ApiProperty({
    isArray: true,
    oneOf: [
      { $ref: getSchemaPath(AssetShareItemModel) },
      { $ref: getSchemaPath(AlbumShareItemModel) },
    ],
  })
  items!: ShareListItem[];

  @ApiProperty({ type: Number, description: 'Whole-match count, not a page size' })
  total!: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'null on the last page' })
  nextCursor?: string | null;
}

export class PublicShareInfoModel implements PublicShareInfo {
  @ApiProperty({ enum: ['asset', 'album'] })
  kind!: 'asset' | 'album';

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt!: string | null;
}

export class PublicShareAssetModel implements PublicShareAsset {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: ['photo', 'video'] })
  kind!: 'photo' | 'video';

  @ApiProperty({ type: Boolean })
  hasTranscode!: boolean;

  @ApiProperty({ type: String })
  contentVersion!: string;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({ type: String, nullable: true })
  originalName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  mimeType!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  width!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  height!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  durationSeconds!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  takenAt!: string | null;
}

export class PublicAlbumInfoModel {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: Number })
  assetCount!: number;
}

export class PublicAssetShareResponseModel implements PublicAssetShareResponse {
  @ApiProperty({ enum: ['asset'] })
  kind!: 'asset';

  @ApiProperty({ type: () => PublicShareInfoModel })
  share!: PublicShareInfoModel;

  @ApiProperty({ type: () => PublicShareAssetModel })
  asset!: PublicShareAssetModel;
}

export class PublicAlbumShareResponseModel implements PublicAlbumShareResponse {
  @ApiProperty({ enum: ['album'] })
  kind!: 'album';

  @ApiProperty({ type: () => PublicShareInfoModel })
  share!: PublicShareInfoModel;

  @ApiProperty({ type: () => PublicAlbumInfoModel })
  album!: PublicAlbumInfoModel;
}

export class PublicAlbumAssetsResponseModel implements PublicAlbumAssetsResponse {
  @ApiProperty({ type: [PublicShareAssetModel] })
  items!: PublicShareAssetModel[];

  @ApiProperty({ type: Number, description: 'Whole-album count, not a page size' })
  total!: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'null on the last page' })
  nextCursor?: string | null;
}

// --- ingest ------------------------------------------------------------------

export class StorageQuotaResponseModel implements StorageQuotaResponse {
  @ApiProperty({ type: Number })
  usedBytes!: number;

  @ApiProperty({ type: Number, nullable: true, description: 'null = unlimited' })
  limitBytes!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'null = unlimited' })
  remainingBytes!: number | null;
}

export class FileExistsCheckHitModel implements FileExistsCheckHit {
  @ApiProperty({ type: String })
  checksumSha256!: string;

  @ApiProperty({ type: Boolean })
  exists!: boolean;

  @ApiPropertyOptional({ type: String })
  existingFileId?: string;

  @ApiPropertyOptional({ type: String })
  existingAssetId?: string;
}

export class FileExistsCheckResponseModel implements FileExistsCheckResponse {
  @ApiProperty({ type: [FileExistsCheckHitModel], description: 'Preserves input order' })
  items!: FileExistsCheckHitModel[];
}

// --- resumable uploads -------------------------------------------------------

export class UploadSessionCreatedModel implements UploadSessionCreated {
  @ApiProperty({ type: String })
  uploadId!: string;

  @ApiProperty({ type: Number, example: 8388608 })
  chunkSizeBytes!: number;

  @ApiProperty({ type: Number })
  totalParts!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ enum: ['pending', 'assembling', 'assembled', 'completed', 'failed', 'expired'] })
  status!: UploadSessionCreated['status'];
}

export class UploadSessionStatusResponseModel implements UploadSessionStatusResponse {
  @ApiProperty({ enum: ['pending', 'assembling', 'assembled', 'completed', 'failed', 'expired'] })
  status!: UploadSessionStatusResponse['status'];

  @ApiProperty({ type: Number })
  chunkSizeBytes!: number;

  @ApiProperty({ type: Number })
  totalParts!: number;

  @ApiProperty({ type: [Number], description: 'Zero-based indexes received so far' })
  receivedParts!: number[];

  @ApiProperty({ type: Number })
  receivedBytes!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;

  @ApiPropertyOptional({ type: String })
  assetId?: string;

  @ApiPropertyOptional({ type: String })
  fileId?: string;
}

export class UploadCompleteResponseModel implements UploadCompleteResponse {
  @ApiProperty({ type: () => AssetModel })
  asset!: AssetModel;

  @ApiProperty({
    type: Boolean,
    description: 'true = this request stored no new bytes (201 when false, 200 when true)',
  })
  deduplicated!: boolean;
}

// --- admin users -------------------------------------------------------------

export class AdminUserRowModel implements AdminUserRow {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String, format: 'email' })
  email!: string;

  @ApiProperty({ enum: ['user', 'admin'] })
  role!: 'user' | 'admin';

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** PATCH :id row: `AdminUserRow` plus the edit timestamp. */
export class AdminUserProfileModel implements AdminUserRow {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String, format: 'email' })
  email!: string;

  @ApiProperty({ enum: ['user', 'admin'] })
  role!: 'user' | 'admin';

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class AdminUserListResponseModel implements AdminUserListResponse {
  @ApiProperty({ type: [AdminUserRowModel] })
  items!: AdminUserRowModel[];

  @ApiProperty({ type: Number, description: 'Whole-match count, not a page size' })
  total!: number;
}

export class AdminUserBackupSyncModel implements AdminUserBackupSync {
  @ApiProperty({ type: Boolean })
  synced!: boolean;

  @ApiProperty({ type: Boolean })
  moved!: boolean;

  @ApiPropertyOptional({ type: String })
  from?: string;

  @ApiProperty({ type: String })
  to!: string;

  @ApiPropertyOptional({ enum: ['no-backup'] })
  reason?: 'no-backup';

  @ApiPropertyOptional({ type: String })
  error?: string;
}

export class AdminUserUpdateResponseModel implements AdminUserUpdateResponse {
  @ApiProperty({ type: () => AdminUserProfileModel })
  user!: AdminUserProfileModel;

  @ApiProperty({ type: () => AdminUserBackupSyncModel })
  backup!: AdminUserBackupSyncModel;
}

export class AdminUserDeleteResponseModel implements AdminUserDeleteResponse {
  @ApiProperty({ type: String })
  jobId!: string;

  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: Boolean, example: true, description: 'The S3 backup prefix is left intact' })
  backupKept!: true;

  @ApiProperty({ type: String })
  backupPrefix!: string;
}

export class AdminUserDeleteStatusModel implements AdminUserDeleteStatus {
  @ApiProperty({ type: String })
  jobId!: string;

  @ApiProperty({
    enum: ['queued', 'active', 'wiping-files', 'completed', 'partial', 'failed', 'unknown'],
  })
  state!: AdminUserDeleteState;

  @ApiProperty({ type: Boolean, example: true })
  backupKept!: true;

  @ApiProperty({ type: String })
  backupPrefix!: string;

  @ApiPropertyOptional({
    enum: [
      'tokens',
      'assets',
      'files',
      'faces',
      'persons',
      'albums',
      'shares',
      'sessions',
      'ledger',
      'user',
      'rows-done',
    ],
  })
  phase?: UserDeletePhase;

  @ApiPropertyOptional({ type: Number })
  deletedRows?: number;

  @ApiPropertyOptional({ type: Number })
  deletedFiles?: number;

  @ApiPropertyOptional({ type: Number })
  failedFiles?: number;

  @ApiPropertyOptional({ type: String })
  error?: string;
}

// --- backups -----------------------------------------------------------------

export class BackupResultModel implements BackupResult {
  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: String })
  email!: string;

  @ApiProperty({ type: String })
  prefix!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  backedUpAt!: string;

  @ApiProperty({ type: Number })
  files!: number;

  @ApiProperty({ type: Number })
  assets!: number;

  @ApiProperty({ type: Number })
  albums!: number;

  @ApiProperty({ type: Number })
  shares!: number;

  @ApiProperty({ type: Number })
  persons!: number;

  @ApiProperty({ type: Number })
  uploaded!: number;

  @ApiProperty({ type: Number })
  skipped!: number;
}

export class EnqueuedJobsModel {
  @ApiProperty({ type: Number })
  metadata!: number;

  @ApiProperty({ type: Number })
  thumbnails!: number;

  @ApiProperty({ type: Number })
  videos!: number;

  @ApiProperty({ type: Number })
  faces!: number;

  @ApiProperty({ type: Number })
  ai!: number;
}

export class RestoreResultModel implements RestoreResult {
  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: String })
  email!: string;

  @ApiProperty({ type: String })
  prefix!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  backedUpAt!: string;

  @ApiProperty({ type: Number })
  files!: number;

  @ApiProperty({ type: Number })
  assets!: number;

  @ApiProperty({ type: Number })
  albums!: number;

  @ApiProperty({ type: Number })
  shares!: number;

  @ApiProperty({ type: Number })
  persons!: number;

  @ApiProperty({ type: Number })
  uploaded!: number;

  @ApiProperty({ type: Number })
  skipped!: number;

  @ApiProperty({
    type: 'object',
    properties: {
      emailAtBackup: { type: 'string' },
      prefix: { type: 'string' },
      manifestObjectKey: { type: 'string' },
    },
    required: ['emailAtBackup', 'prefix', 'manifestObjectKey'],
  })
  restoredFrom!: { emailAtBackup: string; prefix: string; manifestObjectKey: string };

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  completedAt!: string;

  @ApiProperty({ type: () => EnqueuedJobsModel })
  enqueued!: EnqueuedJobsModel;

  @ApiPropertyOptional({ type: String })
  reassignmentError?: string;
}

export class BackupStatusModel implements BackupStatus {
  @ApiProperty({ type: Boolean })
  exists!: boolean;

  @ApiPropertyOptional({ enum: ['unreadable', 'corrupt'] })
  degraded?: 'unreadable' | 'corrupt';

  @ApiPropertyOptional({ type: String })
  userId?: string;

  @ApiPropertyOptional({ type: String })
  emailAtBackup?: string;

  @ApiPropertyOptional({ enum: ['user', 'admin'] })
  role?: 'user' | 'admin';

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  backedUpAt?: string;

  @ApiPropertyOptional({ type: Number })
  files?: number;

  @ApiPropertyOptional({ type: Number })
  assets?: number;

  @ApiPropertyOptional({ type: Number })
  albums?: number;

  @ApiPropertyOptional({ type: Number })
  shares?: number;

  @ApiPropertyOptional({ type: Number })
  persons?: number;
}

export class BackupProgressModel implements BackupProgress {
  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: Boolean })
  inProgress!: boolean;

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  completed!: number;

  @ApiProperty({ type: Number })
  uploaded!: number;

  @ApiProperty({ type: Number })
  skipped!: number;

  @ApiPropertyOptional({ type: String })
  currentFile?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

@ApiExtraModels(BackupResultModel, RestoreResultModel)
export class BackupRunStatusModel implements BackupRunStatus {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: ['backup', 'restore'] })
  kind!: 'backup' | 'restore';

  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ enum: ['running', 'paused', 'finalizing', 'completed', 'failed', 'cancelled'] })
  state!: BackupRunStatus['state'];

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  completed!: number;

  @ApiProperty({ type: Number })
  uploaded!: number;

  @ApiProperty({ type: Number })
  skipped!: number;

  @ApiProperty({ type: Number })
  failed!: number;

  @ApiPropertyOptional({ type: String })
  currentFile?: string;

  @ApiPropertyOptional({ type: String })
  error?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  finishedAt?: string;

  // A restore result extends the backup result, so the two shapes are told apart by `restoredFrom`.
  @ApiPropertyOptional({
    oneOf: [
      { $ref: getSchemaPath(BackupResultModel) },
      { $ref: getSchemaPath(RestoreResultModel) },
    ],
  })
  result?: BackupResult | RestoreResult;
}

export class BackupSnapshotModel implements BackupSnapshot {
  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: String })
  emailAtBackup!: string;

  @ApiProperty({ type: String })
  prefix!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  backedUpAt!: string | null;

  @ApiProperty({ type: Number })
  assets!: number;

  @ApiProperty({ type: Number })
  files!: number;

  @ApiProperty({ type: Number })
  albums!: number;

  @ApiProperty({ type: Number })
  shares!: number;

  @ApiProperty({ type: Number })
  persons!: number;

  @ApiProperty({ type: Boolean })
  exists!: boolean;

  @ApiPropertyOptional({ enum: ['unreadable', 'corrupt'] })
  degraded?: 'unreadable' | 'corrupt';

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  mergedAt?: string;
}

export class ActiveBackupRunModel {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: ['backup', 'restore'] })
  kind!: 'backup' | 'restore';

  @ApiProperty({ enum: ['running', 'paused', 'finalizing', 'completed', 'failed', 'cancelled'] })
  state!: BackupRunStatus['state'];
}

export class BackupOverviewRowModel implements BackupOverviewRow {
  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: String })
  email!: string;

  @ApiProperty({ enum: ['user', 'admin'] })
  role!: 'user' | 'admin';

  @ApiProperty({ type: Number })
  totalAssets!: number;

  @ApiProperty({ type: Number })
  backedUpAssets!: number;

  @ApiProperty({ type: Number })
  backedUpFiles!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  backedUpAt!: string | null;

  @ApiProperty({ type: Boolean })
  exists!: boolean;

  @ApiPropertyOptional({ enum: ['unreadable', 'corrupt'] })
  degraded?: 'unreadable' | 'corrupt';

  @ApiProperty({ type: Number })
  notBackedUp!: number;

  @ApiProperty({ type: Boolean })
  deleted!: boolean;

  @ApiPropertyOptional({ type: String })
  emailAtBackup?: string;

  @ApiPropertyOptional({ type: String })
  prefix?: string;

  @ApiPropertyOptional({ type: [BackupSnapshotModel] })
  legacyBackups?: BackupSnapshotModel[];

  @ApiPropertyOptional({ type: Number })
  backedUpAlbums?: number;

  @ApiPropertyOptional({ type: Number })
  backedUpShares?: number;

  @ApiPropertyOptional({ type: Number })
  backedUpPersons?: number;

  @ApiPropertyOptional({ type: () => ActiveBackupRunModel })
  activeRun?: ActiveBackupRunModel;
}

export class DeleteBackupResultModel implements DeleteBackupResult {
  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: String })
  email!: string;

  @ApiProperty({ type: String })
  prefix!: string;

  @ApiProperty({ type: Number })
  deletedObjects!: number;
}

export class MergeCountsModel {
  @ApiProperty({ type: Number })
  files!: number;

  @ApiProperty({ type: Number })
  assets!: number;

  @ApiProperty({ type: Number })
  albums!: number;

  @ApiProperty({ type: Number })
  albumAssets!: number;

  @ApiProperty({ type: Number })
  shares!: number;

  @ApiProperty({ type: Number })
  persons!: number;
}

export class MergeDedupedModel {
  @ApiProperty({ type: Number })
  files!: number;

  @ApiProperty({ type: Number })
  assets!: number;
}

export class MergeSkippedModel {
  @ApiProperty({ type: Number })
  files!: number;

  @ApiProperty({ type: Number })
  assets!: number;

  @ApiProperty({ type: Number })
  albums!: number;

  @ApiProperty({ type: Number })
  albumAssets!: number;

  @ApiProperty({ type: Number })
  shares!: number;

  @ApiProperty({ type: Number })
  persons!: number;

  @ApiProperty({ type: Number })
  shareTokenConflicts!: number;

  @ApiProperty({ type: Number })
  shareTargetConflicts!: number;
}

export class MergeAssignedModel {
  @ApiProperty({ type: String })
  prefix!: string;

  @ApiProperty({ type: Number })
  copiedObjects!: number;

  @ApiProperty({ type: Number })
  reusedObjects!: number;

  @ApiProperty({ type: Boolean })
  unionedWithExisting!: boolean;

  @ApiProperty({ type: Boolean })
  sourceDeleted!: boolean;
}

export class MergeBackupResultModel implements MergeBackupResult {
  @ApiProperty({ type: String })
  targetUserId!: string;

  @ApiProperty({ type: String })
  targetEmail!: string;

  @ApiProperty({ type: String })
  backupUserId!: string;

  @ApiProperty({ type: String })
  emailAtBackup!: string;

  @ApiProperty({ type: String })
  prefix!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  backedUpAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  completedAt!: string;

  @ApiProperty({ type: () => MergeCountsModel })
  merged!: MergeCountsModel;

  @ApiProperty({ type: () => MergeDedupedModel })
  deduped!: MergeDedupedModel;

  @ApiProperty({ type: () => MergeSkippedModel })
  skipped!: MergeSkippedModel;

  @ApiProperty({ type: () => EnqueuedJobsModel })
  enqueued!: EnqueuedJobsModel;

  @ApiProperty({
    type: () => MergeAssignedModel,
    nullable: true,
    description: 'null when adoption failed; the merge rows stay and a retry is allowed',
  })
  assigned!: MergeAssignedModel | null;

  @ApiPropertyOptional({ type: String })
  adoptionError?: string;
}

// --- admin assets ------------------------------------------------------------

export class AssetFailureCountsModel implements AssetFailureCounts {
  @ApiProperty({ type: Number })
  processing!: number;

  @ApiProperty({ type: Number })
  metadata!: number;

  @ApiProperty({ type: Number })
  thumbnails!: number;

  @ApiProperty({ type: Number })
  encoding!: number;
}

export class AdminAssetCountsResponseModel implements AdminAssetCountsResponse {
  @ApiProperty({ type: () => AssetFailureCountsModel })
  photos!: AssetFailureCountsModel;

  @ApiProperty({ type: () => AssetFailureCountsModel })
  videos!: AssetFailureCountsModel;
}

export class AdminLibraryCountsModel implements AdminLibraryCounts {
  @ApiProperty({ type: Number })
  photos!: number;

  @ApiProperty({ type: Number })
  videos!: number;

  @ApiProperty({ type: Number })
  trashed!: number;
}

export class AdminLibraryUploadsWeekModel implements AdminLibraryUploadsWeek {
  @ApiProperty({ type: String, description: 'Monday of the week, YYYY-MM-DD' })
  week!: string;

  @ApiProperty({ type: Number })
  photos!: number;

  @ApiProperty({ type: Number })
  videos!: number;
}

export class AdminLibraryStorageMonthModel implements AdminLibraryStorageMonth {
  @ApiProperty({ type: String, description: 'First day of the month, YYYY-MM-DD' })
  month!: string;

  @ApiProperty({ type: Number })
  originalsBytes!: number;

  @ApiProperty({ type: Number })
  transcodesBytes!: number;

  @ApiProperty({ type: Number })
  thumbnailsBytes!: number;
}

export class AdminLibraryStatsResponseModel implements AdminLibraryStatsResponse {
  @ApiProperty({ type: () => AdminLibraryCountsModel })
  counts!: AdminLibraryCountsModel;

  @ApiProperty({ type: [AdminLibraryUploadsWeekModel] })
  uploadsByWeek!: AdminLibraryUploadsWeekModel[];

  @ApiProperty({ type: [AdminLibraryStorageMonthModel] })
  storageByMonth!: AdminLibraryStorageMonthModel[];
}

// --- admin maintenance -------------------------------------------------------

export class FaceDetectionSettingsModel implements FaceDetectionSettings {
  @ApiProperty({ type: Boolean })
  modelAvailable!: boolean;
}

export class OrphanCountsResponseModel {
  @ApiProperty({ type: Number })
  orphanFiles!: number;

  @ApiProperty({ type: Number })
  orphanThumbnails!: number;
}

export class CleanupOrphansResponseModel {
  @ApiProperty({ type: Number })
  deletedFiles!: number;

  @ApiProperty({ type: Number })
  deletedThumbnails!: number;

  @ApiProperty({ type: Number })
  deletedStrays!: number;
}

export class AdminReprocessThumbnailsResponseModel implements AdminReprocessThumbnailsResponse {
  @ApiProperty({ type: Number })
  enqueued!: number;

  @ApiProperty({ type: Number })
  totalAssets!: number;
}

/** Shared body of the per-kind reprocess POSTs. */
export class EnqueuedTotalResponseModel {
  @ApiProperty({ type: Number })
  enqueued!: number;

  @ApiProperty({ type: Number })
  total!: number;
}

export class ReprocessEmbeddingsResponseModel {
  @ApiProperty({ type: Number })
  enqueued!: number;

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: String })
  model!: string;
}

export class ReclusterResponseModel {
  @ApiProperty({ type: Number, description: 'One cluster job per distinct user with faces' })
  enqueued!: number;
}

export class PlacesBackfillResponseModel {
  @ApiProperty({ type: Number })
  updated!: number;

  @ApiProperty({ type: Number })
  total!: number;
}

/** Last-run record written by the enqueue POSTs (`settings.LastRun<K>`). */
export class EnqueuedRunModel {
  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  enqueued!: number;
}

export class EmbeddingRunModel {
  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  enqueued!: number;

  @ApiProperty({ type: String })
  model!: string;
}

export class PlacesRunModel {
  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  updated!: number;
}

/** GET faces|detections|metadata/reprocess — identical shape for the three kinds. */
export class ReprocessStatusModel {
  @ApiProperty({ type: () => EnqueuedRunModel, nullable: true })
  lastRun!: EnqueuedRunModel | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { waiting: 0, active: 0 },
  })
  queue!: Record<string, number>;
}

export class EmbeddingReprocessStatusModel {
  @ApiProperty({ type: () => EmbeddingRunModel, nullable: true })
  lastRun!: EmbeddingRunModel | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { waiting: 0, active: 0 },
  })
  queue!: Record<string, number>;
}

export class PlacesBackfillStatusModel {
  @ApiProperty({ type: () => PlacesRunModel, nullable: true })
  lastRun!: PlacesRunModel | null;
}
