export type Role = 'user' | 'admin'

export interface User {
  id: string
  email: string
  role: Role
  displayName: string
  avatarUrl?: string
  createdAt: string
  updatedAt: string
}

export interface RegisterRequest {
  email: string
  password: string
  displayName: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RefreshRequest {
  refreshToken: string
}

export interface JwtPayload {
  sub: string
  email: string
  role: Role
  iat: number
  exp: number
  jti?: string
  // RFC 8693 actor claim — present only on worker-minted tokens; core's guard locks
  // act-carrying tokens to the admin-route allowlist in auth/open-routes.ts
  act?: { sub: string }
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: User
}

export interface FileRecord {
  id: string
  userId: string
  storageKey: string
  originalName: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string
  purpose: 'original' | 'transcode'
  assetId: string | null
  createdAt: string
}

export interface FileSummary {
  id: string
  userId: string
  originalName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

export interface FileListResponse {
  items: FileSummary[]
  total: number
  limit: number
  offset: number
}

export interface BatchFilesResponse {
  items: FileRecord[]
  missing: string[]
}

export type AssetKind = 'photo' | 'video'

export type MetadataStatus = 'pending' | 'ready' | 'failed'

export type TranscodeStatus = 'pending' | 'ready' | 'failed' | null

export type ThumbnailStatus = 'pending' | 'ready' | 'failed' | null

export interface Asset {
  id: string
  userId: string
  kind: AssetKind
  fileId: string
  uploadedAt: string
  isTrashed: boolean
  trashedAt: string | null
  title: string | null
  description: string | null
  takenAt: string | null
  favorite: boolean
  mimeType: string | null
  sizeBytes: number | null
  originalName: string | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  cameraMake: string | null
  cameraModel: string | null
  lensModel: string | null
  orientation: number | null
  iso: number | null
  fNumber: number | null
  exposureTime: number | null
  focalLength: number | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  fps: number | null
  codec: string | null
  hasAudio: boolean | null
  metadata: Record<string, unknown> | null
  metadataStatus: MetadataStatus
  metadataExtractedAt: string | null
  transcodeStatus: TranscodeStatus
  transcodeFileId: string | null
  thumbnailStatus: ThumbnailStatus
  thumbnails?: AssetThumbnail[]
  faceStatus: 'pending' | 'ready' | 'failed' | null
  faceCount: number | null
  faces?: FaceDto[]
}

export interface AssetListResponse {
  items: Asset[]
  total: number
  limit: number
  offset: number
}

// GET /api/v1/search response — items reuse the list-assets Asset shape verbatim
export interface SearchResponse {
  items: Asset[]
  total: number
}

export interface AssetLayoutItem {
  t: string
  w: number
  h: number
}

export interface AssetLayout {
  items: AssetLayoutItem[]
}

export interface AssetThumbnail {
  size: string
  fileId: string
  width: number
  height: number
  bytes: number
  createdAt: string
}

export type AssetThumbnailListResponse = AssetThumbnail[]

export type AdminUserSortField = 'createdAt' | 'displayName' | 'email' | 'role'

export interface AdminUserRow {
  id: string
  displayName: string
  email: string
  role: Role
  createdAt: string
}

export interface AdminUserListResponse {
  items: AdminUserRow[]
  total: number
  limit: number
  offset: number
}

export interface AssetFailureCounts {
  processing: number
  metadata: number
  thumbnails: number
  encoding: number
}

export interface AdminAssetCountsResponse {
  photos: AssetFailureCounts
  videos: AssetFailureCounts
}

export interface AdminReprocessThumbnailsRequest {
  kind: 'photo' | 'video'
}

export interface AdminReprocessThumbnailsResponse {
  enqueued: number
  totalAssets: number
}

export interface AdminAssetReprocessRow {
  id: string
  userId: string
  fileId: string
}

export interface AdminAssetReprocessListResponse {
  items: AdminAssetReprocessRow[]
  total: number
}

export interface AdminLibraryCounts {
  photos: number
  videos: number
  trashed: number
}

export interface AdminLibraryUploadsWeek {
  week: string
  photos: number
  videos: number
}

export interface AdminLibraryStorageMonth {
  month: string
  originalsBytes: number
  transcodesBytes: number
  thumbnailsBytes: number
}

// Library-wide admin stats: active counts, last 26 weeks of uploads (contiguous, zero-filled,
// week = Monday 'YYYY-MM-DD') and per-month storage additions from file_records/thumbnails
// (contiguous, zero-filled, month = first day 'YYYY-MM-DD').
export interface AdminLibraryStatsResponse {
  counts: AdminLibraryCounts
  uploadsByWeek: AdminLibraryUploadsWeek[]
  storageByMonth: AdminLibraryStorageMonth[]
}

// ponytail: single source of truth for the embedding dim (InsightFace buffalo_l w600k_r50) —
// detector output, DTO validation, cluster filters, and the HNSW index cast all reference this
export const FACE_EMBEDDING_DIM = 512

// SigLIP2-B/16 image embeddings — entity transformer, index cast and query code share this
export const SEARCH_EMBEDDING_DIM = 768

// SigLIP2-B/16 ONNX model id; the bootstrap partial HNSW index DDL hardcodes this same literal
// (ANN over one row set must not mix models, so the predicate filters on it)
export const SEARCH_EMBEDDING_MODEL = 'siglip2-b16-224'

// Cross-modal contract (SigLIP2 has NO projection layers): image and text embeddings must both be
// the pooled output of their own tower, finalized by the SAME shared toEmbedding() below:
//   image tower (worker): vision pooler_output from the image-feature-extraction pipeline (pool: true)
//   text tower (P3, core): SiglipTextModel pooler_output — last_hidden_state[:, -1] through the
//     learned head Linear inside text_model_int8.onnx.
// A feature-extraction pipeline's mean/CLS pooling silently drops that head and lands in a
// different 768-d space the dim assert cannot catch.
export function l2Normalize(vec: ArrayLike<number>): number[] {
  const arr = Array.from(vec)
  let norm = 0
  for (const v of arr) norm += v * v
  if (norm === 0) return arr
  const scale = 1 / Math.sqrt(norm)
  return arr.map((v) => v * scale)
}

// ponytail: one finalizer for every 768-d search tower — assert the shared dim, then L2-normalize
// so ANN dot product == cosine similarity. Face embeddings (512-d) use l2Normalize directly.
export function toEmbedding(raw: ArrayLike<number>): number[] {
  const vec = Array.from(raw)
  if (vec.length !== SEARCH_EMBEDDING_DIM) {
    throw new Error(`Unexpected embedding dim ${vec.length}, expected ${SEARCH_EMBEDDING_DIM}`)
  }
  return l2Normalize(vec)
}

// Wire contract for POST /api/v1/assets/:id/embedding — the worker registers one image embedding
// for the asset owner; kind/model/dim are enforced core-side with 422
export interface RegisterEmbeddingRequestDto {
  kind: 'image'
  model: string
  embedding: number[]
}

// Wire contract for POST /api/v1/assets/:id/ocr — the worker registers ONE concatenated text row
// per asset (asset_ocr PK is assetId); text/lang/confidence are enforced core-side with 422
export interface RegisterOcrRequestDto {
  text: string
  lang: string | null
  confidence: number | null
}

// Wire contracts for POST/GET /api/v1/assets/:id/detections — box is ORIGINAL-image pixel coords.
// POST replaces the asset's whole row set; GET returns the viewer-overlay payload.
export interface DetectionBox {
  x: number
  y: number
  w: number
  h: number
}

export interface DetectedObjectInput {
  label: string
  confidence: number
  box: DetectionBox
}

export interface RegisterDetectionsRequestDto {
  detections: DetectedObjectInput[]
}

export interface AssetDetectionDto {
  label: string
  confidence: number
  box: DetectionBox
}

export interface AssetDetectionsResponse {
  detections: AssetDetectionDto[]
}

// GET /api/v1/assets/:id/duplicates and /similar — items reuse the list-assets Asset shape
export interface RelatedAssetsResponse {
  items: Asset[]
  total: number
}

// GET /api/v1/events — time+place grouped trips; `id` is a stable listing key, not a resource
export interface EventGroupDto {
  id: string
  label: string
  takenFrom: string
  takenTo: string
  placeCity: string | null
  placeCountryCode: string | null
  count: number
  coverAssetId: string
}

export interface EventsResponse {
  groups: EventGroupDto[]
}

export const FACE_DETECTOR_KINDS = ['human', 'scrfd'] as const
export type FaceDetectorKind = (typeof FACE_DETECTOR_KINDS)[number]

// Admin-configurable detector choice: `detector` is the persisted setting, `envDefault` the
// FACE_DETECTOR env fallback, `models.scrfd` whether det_10g.onnx is provisioned on disk,
// `facesByDetector` how many stored faces carry each provenance (null -> unset).
export interface FaceDetectionSettings {
  detector: FaceDetectorKind
  envDefault: FaceDetectorKind
  models: { scrfd: boolean }
  facesByDetector: { human: number; scrfd: number; unset: number }
}

export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
}

export interface FaceDto {
  id: string
  assetId: string
  box: FaceBox
  confidence: number
  personId?: string | null
}

export interface DetectedFaceInput {
  box: FaceBox
  confidence: number
  embedding: number[]
}

export interface RegisterFacesRequestDto {
  faces: DetectedFaceInput[]
  detector?: FaceDetectorKind
}

export interface RegisterFacesResponseDto {
  count: number
}

export interface PersonDto {
  id: string
  userId: string
  name: string | null
  coverFaceId: string | null
  coverFaceUrl: string | null
  clusterLabel: string | null
  faceCount: number
  createdAt: string
  updatedAt: string
}

export interface PersonListResponse {
  items: PersonDto[]
  total: number
  limit: number
  offset: number
}

export interface PersonAssetItem {
  assetId: string
  faceId: string
  uploadedAt: string
  faceCount: number
}

export interface PersonAssetsResponse {
  personId: string
  items: PersonAssetItem[]
  total: number
  limit: number
  offset: number
}

export interface UpdatePersonRequest {
  name: string | null
}

export interface ReassignFacesRequest {
  toPersonId: string | null
  faceIds: string[]
}

export interface ReassignFacesResponse {
  moved: number
}

export * from './albums'
export * from './shares'
