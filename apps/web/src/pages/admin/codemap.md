# apps/web/src/pages/admin/

## Responsibility

`/admin` operator console, admin-only: asset-processing health, thumbnail reprocessing, orphan cleanup, and a searchable/sortable/paginated user table. All actions enqueue worker jobs — nothing is processed in-request.

## Design

- Guard stack is `<RequireAuth><RequireAdmin>` (non-admins redirect `/`); `Sidebar` only shows the Admin link for `user.role === 'admin'`.
- `AdminPageContent` composes four independent sections, each owning loading/error/retry state:
  - `AssetHealthSection` → `getAdminAssetCounts()`; two `FailureCard`s (Pictures: processing/metadata/thumbnails; Videos: + encoding) with red counts when > 0, `SkeletonCard`s while loading, refresh button bumps a local `version`.
  - `ThumbnailReprocessSection` → confirm modal then `reprocessThumbnails('photo')`, reports `enqueued`/`totalAssets`; warns that workers run one at a time.
  - `OrphanCleanupSection` → `getOrphanCounts()` tiles (orphan files / orphan thumbnails), confirm then `cleanupOrphans()` (enqueue-only message), cleanup disabled when both counts are zero.
  - User table → `listAdminUsers({limit: 20, offset, q, sortField, sortDir})`; search input is debounced 250ms, sort toggles via `SortHeader` (asc/desc, defaults desc for `createdAt`/`email`), Prev/Next pagination reads `total`. `RoleBadge` distinguishes admin/user, `formatBytes` renders `bytesUsed`.
- All state is local (`useState`/`useEffect` + cancellation flags); no zustand, no extracted hook.
- Search is debounced 250ms via `setTimeout`; changing the query or sort resets `offset` to 0 through a separate effect.
- Sort defaults: `createdAt`/`email` start desc, other columns asc; clicking the active header flips direction.
- The route has no params and only the `Sidebar` links to it; the global `JwtAuthGuard` enforces admin on `api/v1/admin/*` centrally.

## Flow

Mount → health, orphan counts, and users fetch in parallel → operator triggers reprocess/cleanup → API enqueues BullMQ jobs → count sections refetch via their `version` counters; the UI never polls job status, it just reports "enqueued". User table refetches whenever `debouncedQ`, `sort`, `offset`, or `version` change.

## Integration

`api/admin` (`listAdminUsers`, `getAdminAssetCounts`, `reprocessThumbnails`, `cleanupOrphans`, `getOrphanCounts`) through core `api/v1/admin/*`, where `JwtAuthGuard` enforces the admin role. Types: `AdminUserListResponse`, `AdminUserSortField`, `AdminAssetCountsResponse`. Shell: `AppShell`, guards: `RequireAuth` + `RequireAdmin`.
