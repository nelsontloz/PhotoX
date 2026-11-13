import type { Page } from './pagination';

export type Role = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  role: Role;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

/** Public (and admin) view of the `registration.enabled` app setting. */
export interface RegistrationSettings {
  enabled: boolean;
}

export interface AdminUserCreateRequest {
  email: string;
  password: string;
  displayName: string;
  role?: Role;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  // optional: the HttpOnly photox_refresh cookie is accepted as a fallback
  refreshToken?: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  iat: number;
  exp: number;
  jti?: string;
  // session start (epoch seconds): stamped by core on access tokens and carried through
  // sliding renewals so the guard can enforce the absolute session cap
  sst?: number;
  // device session id (`refresh_tokens.sessionId`): one session per login/device, stable across
  // rotation and carried through sliding renewals so logout revokes only that device
  sid?: string;
  // RFC 8693 actor claim — present only on worker-minted tokens; core's guard locks
  // act-carrying tokens to the admin-route allowlist in auth/open-routes.ts
  act?: { sub: string };
}

export interface AuthResponse {
  accessToken: string;
  // seconds until the access token's own `exp` claim — derived from the token, not a TTL copy
  accessTokenExpiresIn: number;
  refreshToken: string;
  user: User;
}

export interface FileRecord {
  id: string;
  userId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  purpose: 'original' | 'transcode';
  assetId: string | null;
  createdAt: string;
}

type AssetKind = 'photo' | 'video';

export type MetadataStatus = 'pending' | 'ready' | 'failed';

type TranscodeStatus = 'pending' | 'ready' | 'failed' | null;

type ThumbnailStatus = 'pending' | 'ready' | 'failed' | null;

export interface Asset {
  id: string;
  userId: string;
  kind: AssetKind;
  /** Internal byte-store id. Use `contentVersion` + `/assets/:id/content` instead of routing by it. */
  fileId: string;
  /**
   * Cache token for `GET /api/v1/assets/:id/content` — changes when the display target changes
   * (the worker registers a transcode). Pass it back verbatim as `?v=`; the route ignores it and
   * only the browser cache-key uses it.
   */
  contentVersion: string;
  uploadedAt: string;
  isTrashed: boolean;
  trashedAt: string | null;
  title: string | null;
  description: string | null;
  takenAt: string | null;
  favorite: boolean;
  mimeType: string | null;
  sizeBytes: number | null;
  originalName: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  orientation: number | null;
  iso: number | null;
  fNumber: number | null;
  exposureTime: number | null;
  focalLength: number | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  fps: number | null;
  codec: string | null;
  hasAudio: boolean | null;
  metadata: Record<string, unknown> | null;
  metadataStatus: MetadataStatus;
  metadataExtractedAt: string | null;
  transcodeStatus: TranscodeStatus;
  transcodeFileId: string | null;
  thumbnailStatus: ThumbnailStatus;
  thumbnails?: AssetThumbnail[];
  faceStatus: 'pending' | 'ready' | 'failed' | null;
  faceCount: number | null;
  faces?: FaceDto[];
}

/** `nextCursor` is set when more rows follow; pass it back as `cursor` for the next page. */
export type AssetListResponse = Page<Asset>;

// GET /api/v1/search + GET /api/v1/assets/:id/{duplicates,similar} — items reuse the
// list-assets Asset shape verbatim. `total` is the candidate/returned count here, not a
// whole-library match count (the ranked branches are depth-capped).
export type SearchResponse = Page<Asset>;

// Timeline sync surface: `GET /api/v1/timeline/index` + `GET /api/v1/timeline/window`.
// The index is the revalidation call — a client diffs its per-window `version` against the cached
// one and refetches only the windows that moved. This block is the normative contract; the
// operation descriptions in core's TimelineController repeat it for the OpenAPI document.

interface AssetLayoutItem {
  t: string;
  w: number;
  h: number;
}

export interface AssetLayout {
  items: AssetLayoutItem[];
}

/** One local-calendar-month window for the caller's `tz`. */
export interface AssetLayoutMonth {
  /** Local month key, `YYYY-MM`. */
  key: string;
  /** Window bounds as UTC instants (half-open) — echo them verbatim to the window endpoint. */
  from: string;
  to: string;
  count: number;
  /**
   * Opaque change token for this window. Compare for EQUALITY only: never parse it, never order
   * by it, never assume its format — it is an implementation detail that may change.
   *
   * It moves on: asset add/delete/trash/restore, any asset mutation (dates, title, favourite),
   * a hidden-album toggle or membership change, and album membership changes in `albumId` views.
   * It does NOT move on person clustering (the `faces` table has no `updatedAt`), so `personId`
   * views are deliberately memory-only on the client and must not rely on it.
   */
  version: string;
}

export interface AssetLayoutIndex {
  months: AssetLayoutMonth[];
}

/** One page of one window; walk `nextOffset` until it is null. */
export interface AssetLayoutPage extends AssetLayout {
  /** Echoed from the index: the window's half-open bounds. Never re-derive them client-side. */
  from: string;
  to: string;
  total: number;
  /**
   * The whole window's token, identical to the index's. A page whose version differs from the
   * window's first page means the window changed mid-walk: discard the walk and restart it once.
   */
  version: string;
  /** Row index inside this window — not the collection cursor used by `GET /api/v1/assets`. */
  nextOffset: number | null;
}

export interface AssetThumbnail {
  size: string;
  fileId: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
}

export type AdminUserSortField = 'createdAt' | 'displayName' | 'email' | 'role';

export interface AdminUserRow {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  createdAt: string;
}

export type AdminUserListResponse = Page<AdminUserRow>;

/** Outcome of relocating a user's backup after an account edit. */
export interface AdminUserBackupSync {
  synced: boolean;
  moved: boolean;
  from?: string;
  to: string;
  reason?: 'no-backup';
  error?: string;
}

export interface AdminUserUpdateRequest {
  displayName?: string;
  email?: string;
  password?: string;
}

export interface AdminUserUpdateResponse {
  user: AdminUserRow & { updatedAt: string };
  backup: AdminUserBackupSync;
}

export interface AssetFailureCounts {
  processing: number;
  metadata: number;
  thumbnails: number;
  encoding: number;
}

export interface AdminAssetCountsResponse {
  photos: AssetFailureCounts;
  videos: AssetFailureCounts;
}

export interface AdminReprocessThumbnailsResponse {
  enqueued: number;
  totalAssets: number;
}

export interface AdminAssetReprocessRow {
  id: string;
  userId: string;
  fileId: string;
}

export interface AdminAssetReprocessListResponse {
  items: AdminAssetReprocessRow[];
  total: number;
}

export interface AdminLibraryCounts {
  photos: number;
  videos: number;
  trashed: number;
}

export interface AdminLibraryUploadsWeek {
  week: string;
  photos: number;
  videos: number;
}

export interface AdminLibraryStorageMonth {
  month: string;
  originalsBytes: number;
  transcodesBytes: number;
  thumbnailsBytes: number;
}

// Library-wide admin stats: active counts, last 26 weeks of uploads (contiguous, zero-filled,
// week = Monday 'YYYY-MM-DD') and per-month storage additions from file_records/thumbnails
// (contiguous, zero-filled, month = first day 'YYYY-MM-DD').
export interface AdminLibraryStatsResponse {
  counts: AdminLibraryCounts;
  uploadsByWeek: AdminLibraryUploadsWeek[];
  storageByMonth: AdminLibraryStorageMonth[];
}

// ponytail: single source of truth for the embedding dim (InsightFace buffalo_l w600k_r50) —
// detector output, DTO validation, cluster filters, and the HNSW index cast all reference this
export const FACE_EMBEDDING_DIM = 512;

// SigLIP2-B/16 image embeddings — entity transformer, index cast and query code share this
export const SEARCH_EMBEDDING_DIM = 768;

// SigLIP2-B/16 ONNX model id; the bootstrap partial HNSW index DDL hardcodes this same literal
// (ANN over one row set must not mix models, so the predicate filters on it)
export const SEARCH_EMBEDDING_MODEL = 'siglip2-b16-224';

// SigLIP2 was trained with `padding='max_length'` (the tokenizer.json declares Fixed 64): the text
// tower pools the LAST slot of a 64-token padded sequence, so every text encode — core queries and
// the smoke spec alike — must tokenize with `padding: 'max_length', max_length: SEARCH_TEXT_MAX_LENGTH`.
// `padding: true` (batch-longest) or an unpadded single query pools the EOS slot instead and lands
// in a non-aligned, near-orthogonal space the dim assert cannot catch.
export const SEARCH_TEXT_MAX_LENGTH = 64;

// Cross-modal contract (SigLIP2 has NO projection layers): image and text embeddings must both be
// the pooled output of their own tower, finalized by the SAME shared toEmbedding() below:
//   image tower (worker): vision pooler_output from the image-feature-extraction pipeline (pool: true)
//   text tower (P3, core): SiglipTextModel pooler_output — last_hidden_state[:, -1] through the
//     learned head Linear inside text_model_int8.onnx, with SEARCH_TEXT_MAX_LENGTH padding.
// A feature-extraction pipeline's mean/CLS pooling silently drops that head and lands in a
// different 768-d space the dim assert cannot catch.
export function l2Normalize(vec: ArrayLike<number>): number[] {
  const arr = Array.from(vec);
  let norm = 0;
  for (const v of arr) norm += v * v;
  if (norm === 0) return arr;
  const scale = 1 / Math.sqrt(norm);
  return arr.map((v) => v * scale);
}

// ponytail: one finalizer for every 768-d search tower — assert the shared dim, then L2-normalize
// so ANN dot product == cosine similarity. Face embeddings (512-d) use l2Normalize directly.
export function toEmbedding(raw: ArrayLike<number>): number[] {
  const vec = Array.from(raw);
  if (vec.length !== SEARCH_EMBEDDING_DIM) {
    throw new Error(`Unexpected embedding dim ${vec.length}, expected ${SEARCH_EMBEDDING_DIM}`);
  }
  return l2Normalize(vec);
}

// Wire contract for POST /api/v1/assets/:id/embedding — the worker registers one image embedding
// for the asset owner; kind/model/dim are enforced core-side with 422
export interface RegisterEmbeddingRequestDto {
  kind: 'image';
  model: string;
  embedding: number[];
}

// Wire contracts for POST/GET /api/v1/assets/:id/detections — box is ORIGINAL-image pixel coords.
// POST replaces the asset's whole row set; GET returns the viewer-overlay payload.
export interface DetectionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectedObjectInput {
  label: string;
  confidence: number;
  box: DetectionBox;
}

export interface RegisterDetectionsRequestDto {
  detections: DetectedObjectInput[];
}

export interface AssetDetectionDto {
  label: string;
  confidence: number;
  box: DetectionBox;
}

export interface AssetDetectionsResponse {
  detections: AssetDetectionDto[];
}

// SCRFD-10G is the only face detector: `modelAvailable` reports whether det_10g.onnx is
// provisioned on disk, which gates both detection and the admin reprocess card.
export interface FaceDetectionSettings {
  modelAvailable: boolean;
}

export interface FaceDto {
  id: string;
  assetId: string;
  box: DetectionBox;
  confidence: number;
  personId?: string | null;
}

export interface DetectedFaceInput {
  box: DetectionBox;
  confidence: number;
  embedding: number[];
}

export interface RegisterFacesRequestDto {
  faces: DetectedFaceInput[];
}

export interface PersonDto {
  id: string;
  userId: string;
  name: string | null;
  coverFaceId: string | null;
  clusterLabel: string | null;
  faceCount: number;
  createdAt: string;
  updatedAt: string;
}

export type PersonListResponse = Page<PersonDto>;

/** GET /api/v1/worker/faces — internal keyset page the worker walks for clustering. */
export type FaceListResponse = Page<FaceDto>;

export interface UpdatePersonRequest {
  name: string | null;
}

// Wire contract for POST /api/v1/files/exists — batch check which checksums the user
// already uploaded; response preserves input order (exists=false rows carry no ids)
export interface FileExistsCheckItem {
  checksumSha256: string;
}

export interface FileExistsCheckHit {
  checksumSha256: string;
  exists: boolean;
  existingFileId?: string;
  existingAssetId?: string;
}

export interface FileExistsCheckResponse {
  items: FileExistsCheckHit[];
}

// Wire contract for GET /api/v1/files/quota — sum of the user's `originals/` prefix bytes
// (derivative thumbnails share purpose='original' but do not count);
// limitBytes/remainingBytes are null when STORAGE_QUOTA_BYTES is unset (unlimited)
export interface StorageQuotaResponse {
  usedBytes: number;
  limitBytes: number | null;
  remainingBytes: number | null;
}

// Resumable upload sessions — `api/v1/uploads` (owner-scoped, Bearer). A session is created with
// the total size, chunked 8 MiB parts are PUT out of order, then `complete` assembles/dedups.
// Status lifecycle: pending → assembling → assembled → completed (terminal: failed/expired).
export type UploadSessionStatus =
  'pending' | 'assembling' | 'assembled' | 'completed' | 'failed' | 'expired';

// Ingest contract — the two doors (`POST /api/v1/files` multipart, `POST /api/v1/uploads`
// sessions) answer one protocol:
//   - the sha256 checksum is the natural key; a duplicate is SUCCESS, never an error;
//   - `201` means this request stored new bytes, `200` means these bytes were already owned
//     (duplicate, a `complete` replay, or a retry that only re-ran the enqueues);
//   - errors always carry a machine-readable `code` from `IngestErrorCode`;
//   - no `Idempotency-Key` is needed — a retried request is safe by construction.
// Pre-flight: `POST /api/v1/files/exists`, then `GET /api/v1/files/quota`, then upload.

// Machine-readable `code` on every ingest error envelope:
// `{statusCode, message, code}` (plus `receivedParts` for PARTS_MISSING).
export const INGEST_ERROR_CODES = [
  'SIZE_LIMIT',
  'QUOTA_EXCEEDED',
  'SESSION_LIMIT',
  'SESSION_EXPIRED',
  'PARTS_MISSING',
  'PART_CONFLICT',
  'PART_TOO_LARGE',
  'MISSING_LENGTH',
  'INDEX_RANGE',
  'CHECKSUM_MISMATCH',
  'UNSUPPORTED_TYPE',
  'EMPTY_BODY',
  'ENQUEUE_FAILED',
] as const;
export type IngestErrorCode = (typeof INGEST_ERROR_CODES)[number];

// The API-wide error contract. Every non-2xx response is an `ApiErrorBody`: the ingest codes
// above plus one code per failure class the transport itself can produce. Codes are stable —
// clients branch on `code`, never on `message` (prose) or on an `error` reason phrase.
export const API_ERROR_CODES = [
  ...INGEST_ERROR_CODES,
  'VALIDATION_FAILED',
  'INVALID_CURSOR',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE_ENTITY',
  'RATE_LIMITED',
  'RATE_LIMIT_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** One field-level failure inside a validation error. */
export interface ApiErrorDetail {
  /** Dotted path of the offending field, when the error is field-scoped. */
  field?: string;
  message: string;
}

/**
 * The one non-2xx body shape: `{statusCode, code, message, details?, retryAfterSec?, requestId}`.
 * `Retry-After` is also sent as a header when `retryAfterSec` is present.
 */
export interface ApiErrorBody {
  statusCode: number;
  code: ApiErrorCode;
  /** Human-readable sentence; clients display `details` when present, else this. */
  message: string;
  details?: ApiErrorDetail[];
  retryAfterSec?: number;
  /** Correlates the failure with the server log (`X-Request-Id`). */
  requestId?: string;
}

// POST /api/v1/uploads — chunkSizeBytes/totalParts are server-fixed (8 MiB chunks)
export interface UploadSessionCreated {
  uploadId: string;
  chunkSizeBytes: number;
  totalParts: number;
  expiresAt: string;
  status: UploadSessionStatus;
}

// GET /api/v1/uploads/:id — assetId/fileId appear once the session reached `completed`
export interface UploadSessionStatusResponse {
  status: UploadSessionStatus;
  chunkSizeBytes: number;
  totalParts: number;
  receivedParts: number[];
  receivedBytes: number;
  expiresAt: string;
  assetId?: string;
  fileId?: string;
}

// POST /api/v1/uploads/:id/complete — `deduplicated=true` means THIS request stored no new
// bytes: the checksum was already owned, the session was already completed, or a previous
// attempt saved the rows and only the enqueues are being retried. `false` means it stored them
// (the response is `201` then, `200` otherwise).
export interface UploadCompleteResponse {
  asset: Asset;
  deduplicated: boolean;
}

export interface IngestErrorBody extends ApiErrorBody {
  code: IngestErrorCode;
  receivedParts?: number[];
}

export * from './pagination';
export * from './albums';
export * from './shares';

// Async admin user deletion: DELETE /api/v1/admin/users/:id enqueues BullMQ job
// `user-delete-<userId>` (202); GET :id/delete-status polls it. Backups are external
// S3 (`backups/<email>__<userId>/`) and are NEVER touched — backupKept/backupPrefix
// report the prefix that was deliberately left intact.
export interface AdminUserDeleteResponse {
  jobId: string;
  userId: string;
  backupKept: true;
  backupPrefix: string;
}

export type AdminUserDeleteState =
  'queued' | 'active' | 'wiping-files' | 'completed' | 'partial' | 'failed' | 'unknown';

/**
 * One bounded unit of the batched wipe. `tokens` locks the account, `assets`/`files`/…
 * delete rows in chunks, `user` drops the row itself, `rows-done` means the worker may
 * sweep the bytes. See UserDeleteService.step.
 */
export type UserDeletePhase =
  | 'tokens'
  | 'assets'
  | 'files'
  | 'faces'
  | 'persons'
  | 'albums'
  | 'shares'
  | 'sessions'
  | 'ledger'
  | 'user'
  | 'rows-done';

export interface UserDeleteStepResult {
  /** No rows left for this user; the caller must still sweep the storage prefixes. */
  done: boolean;
  phase: UserDeletePhase;
  /** Rows removed by this call. */
  deleted: number;
}

export interface UserDeleteFinishRequest {
  backupPrefix: string;
  filesDeleted: number;
  filesFailed: number;
  /** First file error, reported verbatim on a `partial` run. */
  firstError?: string;
  /** The rows half did not finish: the run is `failed`, not `partial`. */
  error?: string;
}

export interface AdminUserDeleteStatus {
  jobId: string;
  state: AdminUserDeleteState;
  backupKept: true;
  backupPrefix: string;
  phase?: UserDeletePhase;
  deletedRows?: number;
  deletedFiles?: number;
  failedFiles?: number;
  error?: string;
}

// The user-delete queue + job-id contract lives here because core produces and the worker consumes.
export const USER_DELETE_QUEUE = 'user-delete';
export const userDeleteJobId = (userId: string): string => `user-delete-${userId}`;
