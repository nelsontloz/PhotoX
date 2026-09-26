# packages/shared-types/src/

## Responsibility

Three files define every client/server payload: `index.ts` (auth/user/files/assets/faces/
persons/admin plus the barrel), `albums.ts`, and `shares.ts`. Everything is exported
type-only; no values, no validation logic (validation lives in core DTOs).

## Design

`index.ts` (also the package barrel):
- Core unions: `Role = 'user' | 'admin'`, `AssetKind`, `MetadataStatus`, `TranscodeStatus`,
  `ThumbnailStatus`.
- Auth/user: `User`, `RegisterRequest`, `LoginRequest`, `RefreshRequest`, `AuthResponse`.
- Files: `FileRecord`, `FileSummary`, `FileListResponse`, `BatchFilesResponse`.
- Assets: `Asset` (full metadata + pipeline state + optional `faces?: FaceDto[]`),
  `AssetListResponse`, `AssetThumbnail`, `AssetThumbnailListResponse`.
- Admin: `AdminUserSortField`, `AdminUserRow`, `AdminUserListResponse`,
  `AssetFailureCounts`, `AdminAssetCountsResponse`, `AdminReprocessThumbnailsRequest` /
  `AdminReprocessThumbnailsResponse`, `AdminAssetReprocessRow`,
  `AdminAssetReprocessListResponse`.
- Faces/persons: `FaceBox`, `FaceDto`, `DetectedFaceInput`, `RegisterFacesRequestDto`,
  `RegisterFacesResponseDto`, `PersonDto`, `PersonListResponse`, `PersonAssetItem`,
  `PersonAssetsResponse`, `UpdatePersonRequest`, `ReassignFacesRequest`,
  `ReassignFacesResponse`.
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

Compile-time only: core DTOs implement these interfaces, web imports them via `import type`,
and the legacy pact consumer test uses the same response shapes. No runtime effect anywhere.

## Integration

Consumed by `apps/core`, `apps/gateway` (`Role`), `apps/web`, `packages/shared-auth`
(`Role`), and the legacy pact consumer under `apps/web/test/pact/consumer/`. Kept
dependency-free so any layer may import it.
