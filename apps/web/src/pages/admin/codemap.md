# apps/web/src/pages/admin/

## Responsibility

`/admin` operator console, admin-only: asset-processing health, thumbnail reprocessing, face-detector switch, bulk face reprocess/recluster, orphan cleanup, and a searchable/sortable/paginated user table. All actions enqueue worker jobs (or persist the detector setting) — nothing is processed in-request.

## Design

- Guard stack is `<RequireAuth><RequireAdmin>` (non-admins redirect `/`); `Sidebar` only shows the Admin link for `user.role === 'admin'`.
- `AdminPageContent` composes six independent sections, each owning loading/error/retry state:
  - `AssetHealthSection` → `getAdminAssetCounts()`; two `FailureCard`s (Pictures: processing/metadata/thumbnails; Videos: + encoding) with red counts when > 0, `SkeletonCard`s while loading, refresh button bumps a local `version`.
  - `ThumbnailReprocessSection` → confirm modal then `reprocessThumbnails('photo')`, reports `enqueued`/`totalAssets`; warns that workers run one at a time.
  - `FaceDetectionSection` → `getFaceDetection()`; radio cards for `human`/`scrfd` (SCRFD disabled while `models.scrfd` is false, with a "switch anyway" confirm), `setFaceDetector()` on change, persisted-vs-`FACE_DETECTOR`-env note, and an amber mixed-library warning when both `facesByDetector.human` and `.scrfd` are > 0.
  - `FacesReprocessSection` → confirm modal then `reprocessFaces()`; 3s `getFaceReprocessStatus()` poll while `queue.waiting + queue.active > 0` (stops after 5 consecutive failures), progress bar over the last run's `enqueued`, last-run line (time/total/detector), and a `reclusterFaces()` button.
  - `OrphanCleanupSection` → `getOrphanCounts()` tiles (orphan files / orphan thumbnails), confirm then `cleanupOrphans()` (enqueue-only message), cleanup disabled when both counts are zero.
  - User table → `listAdminUsers({limit: 20, offset, q, sortField, sortDir})`; search input is debounced 250ms, sort toggles via `SortHeader` (asc/desc, defaults desc for `createdAt`/`email`), Prev/Next pagination reads `total`. `RoleBadge` distinguishes admin/user.
- All state is local (`useState`/`useEffect` + cancellation flags); no zustand, no extracted hook.
- Search is debounced 250ms via `setTimeout`; changing the query or sort resets `offset` to 0 through a separate effect.
- Sort defaults: `createdAt`/`email` start desc, other columns asc; clicking the active header flips direction.
- The route has no params and only the `Sidebar` links to it; the global `JwtAuthGuard` enforces admin on `api/v1/admin/*` centrally.

## Flow

Mount → health, orphan counts, and users fetch in parallel → operator triggers reprocess/cleanup/detector switch → API enqueues BullMQ jobs (or persists the detector setting) → count sections refetch via their `version` counters; the faces section polls the `process-faces` queue while it drains. User table refetches whenever `debouncedQ`, `sort`, `offset`, or `version` change.

## Integration

`api/admin` (`listAdminUsers`, `getAdminAssetCounts`, `reprocessThumbnails`, `cleanupOrphans`, `getOrphanCounts`, `getFaceDetection`, `setFaceDetector`, `reprocessFaces`, `getFaceReprocessStatus`, `reclusterFaces`) through core `api/v1/admin/*`, where `JwtAuthGuard` enforces the admin role. Types: `AdminUserListResponse`, `AdminUserSortField`, `AdminAssetCountsResponse`, `FaceDetectionSettings`, `FaceDetectorKind`. Shell: `AppShell`, guards: `RequireAuth` + `RequireAdmin`.
