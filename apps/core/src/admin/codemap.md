# apps/core/src/admin/

## Responsibility

Cross-user administrative reads and maintenance triggers: per-user asset counts, processing-failure counters, orphan detection, and queue/inline cleanup and reprocess. Read-only against Postgres except for the inline orphan cleanup (and queue side effects).

## Design

`AdminModule` imports `TypeOrmModule.forFeature([Asset, FileRecord, AssetThumbnail])`; three controllers:

- `AdminController` — `GET api/v1/admin/users/asset-stats`. `UserIdsQueryDto` (comma-separated, max 50); `AdminService.getAssetStatsByUser` groupBy `userId` COUNT via `getRawMany` → `Record<userId, count>`. Admin is enforced centrally by the global `JwtAuthGuard` on the `api/v1/admin/*` prefix; there is no controller-level guard.
- `AdminAssetsController` — `GET api/v1/admin/assets/counts` and `GET api/v1/admin/assets`.
- `AdminMaintenanceController` — `@Controller('api/v1/admin')`.

`AdminAssetsService`:

- `getFailureCounts()` — one grouped query over non-trashed assets returning `photos`/`videos` with `processing` (any status `pending` and `uploadedAt` older than `STUCK_PROCESSING_HOURS = 12`), plus `metadata`/`thumbnails`/`encoding` failure counters.
- `listForReprocess(kind, limit, offset)` — `{ id, userId, fileId }` for non-trashed assets of a kind, oldest first + `total`.
- `getOrphanCounts()` — shared raw UNION (`REFERENCED_FILE_IDS_SQL`: `assets.fileId`, `assets.transcodeFileId`, `asset_thumbnails.fileId`); `FileRecord`s older than 10 minutes not referenced → `orphanFiles`; thumbnails whose `fileId` is not in the referenced file set and older than the cutoff → `orphanThumbnails`.
- `cleanupOrphans()` (worker proxy target, inline) — reuses the same referenced-id/stale-file/orphan-thumb helpers as `getOrphanCounts`, re-queries the referenced set right before deleting, deletes blobs (log-swallow) + `FileRecord` rows, deletes orphan `AssetThumbnail` rows, and walks `STORAGE_DIR` deleting stray keys with no `FileRecord` (skipping `models/**` and `*.tmp`). Returns `{ deletedFiles, deletedThumbnails, deletedStrays }`.

`AdminMaintenanceController` endpoints:

- `GET  api/v1/admin/orphan-counts`
- `POST api/v1/admin/cleanup-orphans` → `bullMq.enqueue('cleanup-orphans', 'cleanup-orphans', {})` → `{ enqueued: true }` (the normal trigger; the worker proxy calls `run` below)
- `POST api/v1/admin/cleanup-orphans/run` → runs `cleanupOrphans()` inline (no queue) and returns the counts; this is what the worker `cleanup-orphans` consumer proxies to
- `POST api/v1/admin/thumbnails/reprocess` (body `{ kind: 'photo' | 'video' }`) → pages assets 500 at a time and calls `enqueueThumbnails(id, fileId, userId, 'thumb-reprocess')` (4 sizes each) → `{ enqueued, totalAssets }`

## Flow

Admin Bearer JWT → global `JwtAuthGuard` (verify + admin role) → service → Postgres / storage. The enqueue endpoint only hands work to BullMQ (`cleanup-orphans`); the `run` endpoint executes the scan inline for the worker proxy; thumbnail reprocess enqueues `process-thumbnail` with `thumb-reprocess-<assetId>-<size>` jobIds.

## Integration

- Consumers live in worker-service (`cleanup-orphans.processor.ts`, `thumbnail.processor.ts`): the cleanup queues are thin proxies back to this module's admin endpoints.
- Wire types `AdminAssetCountsResponse`, `AdminAssetReprocessListResponse`, `AssetFailureCounts` from `@photox/shared-types`; the web admin dashboard consumes the asset-counts/reprocess/orphan-counts endpoints. `GET admin/users/asset-stats` has no client caller (covered by integration tests only).
- `BullMqService` from `src/queue/`.
