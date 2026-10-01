# packages/shared-types/src/

## Responsibility

Three files define every client/server payload plus shared runtime constants: `index.ts` (auth/user/files/assets/faces/
persons/admin plus the barrel), `albums.ts`, and `shares.ts`. Everything is exported
type-only except `FACE_EMBEDDING_DIM` and `FACE_DETECTOR_KINDS`; no validation logic lives here (validation lives in core DTOs).

## Design

`index.ts` (also the package barrel):

- Core unions: `Role = 'user' | 'admin'`, `AssetKind`, `MetadataStatus`, `TranscodeStatus`,
  `ThumbnailStatus`.
- Auth/user: `User`, `RegisterRequest`, `LoginRequest`, `RefreshRequest`, `JwtPayload`, `AuthResponse`.
- Files: `FileRecord`, `FileSummary`, `FileListResponse`, `BatchFilesResponse`.
- Assets: `Asset` (full metadata + pipeline state + optional `faces?: FaceDto[]`),
  `AssetListResponse`, `AssetThumbnail`, `AssetThumbnailListResponse`.
- Admin: `AdminUserSortField`, `AdminUserRow`, `AdminUserListResponse`,
  `AssetFailureCounts`, `AdminAssetCountsResponse`, `AdminReprocessThumbnailsRequest` /
  `AdminReprocessThumbnailsResponse`, `AdminAssetReprocessRow`,
  `AdminAssetReprocessListResponse`.
- Faces/persons: `FaceBox`, `FaceDto`, `DetectedFaceInput`, `RegisterFacesRequestDto` (optional
  `detector` provenance), `RegisterFacesResponseDto`, `FaceDetectorKind` / `FACE_DETECTOR_KINDS`
  (`'human' | 'scrfd'`), `FaceDetectionSettings` (persisted `detector`, `envDefault`,
  `models.scrfd`, `facesByDetector`), `PersonDto`, `PersonListResponse`, `PersonAssetItem`,
  `PersonAssetsResponse`, `UpdatePersonRequest`, `ReassignFacesRequest`,
  `ReassignFacesResponse`.
- `export const FACE_EMBEDDING_DIM = 512` — the embedding dim (folded in from the deleted
  `data-access`); imported by the worker embedder/cluster and specs, enforced at the HTTP
  boundary by core's `DetectedFaceDto`. `export const FACE_DETECTOR_KINDS = ['human', 'scrfd']`
  is the runtime detector enum behind `FaceDetectorKind`, shared by the core DTO/settings and the
  worker zod schema.
- Ends with `export * from './albums'` and `export * from './shares'`, so those names are
  reachable from the barrel.

`albums.ts`: `AlbumDto`, `CreateAlbumDto`, `UpdateAlbumDto`, `AddAssetsToAlbumDto`,
`ListAlbumsQueryDto` (presentational counts like `assetCount`, IDs as strings).

`shares.ts`: `AssetShareDto`, `CreateShareRequest`, `ShareListResponse`,
`PublicShareResponse` (share plus a minimal embedded asset for the unauthenticated
`api/share/:token` page).

Conventions: paginated lists carry `items/total/limit/offset`; nullable entity columns map
to `| null`; dates are ISO strings; `DetectedFaceInput.embedding` is `number[]` matching
`FACE_EMBEDDING_DIM` (512), enforced by the worker/DTO rather than the type.

## Flow

Compile-time contract for core DTOs and web consumers, plus one runtime constant
(`FACE_EMBEDDING_DIM`) used by the worker's face code. The legacy pact consumer test uses the
same response shapes.

## Integration

Consumed by `apps/core`, `apps/web`, `apps/worker-service`, and the legacy pact consumer under
`apps/web/test/pact/consumer/`. No dependencies
of its own, so any layer may import it.
