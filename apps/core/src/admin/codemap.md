# apps/core/src/admin/

## Responsibility

Cross-user administrative reads and maintenance triggers: per-user asset counts, processing-failure counters, orphan detection, and enqueueing cleanup/reprocess jobs. Read-only against Postgres except for queue side effects.

## Design

`AdminModule` imports `TypeOrmModule.forFeature([Asset, FileRecord, AssetThumbnail])`; three controllers:

- `AdminController` — `GET api/v1/admin/users/asset-stats`. `UserIdsQueryDto` (comma-separated, max 50); `AdminService.getAssetStatsByUser` groupBy `userId` COUNT via `getRawMany` → `Record<userId, count>`. No controller-level `AdminGuard` ("trusts the network"; the global `JwtAuthGuard` enforces admin on the `api/v1/admin/*` prefix).
- `AdminAssetsController` — `GET api/v1/admin/assets/counts` and `GET api/v1/admin/assets` (also unguarded in core).
- `AdminMaintenanceController` — `@UseGuards(AdminGuard)` + `@Controller('api/v1/admin')`.

`AdminAssetsService`:

- `getFailureCounts()` — one grouped query over non-trashed assets returning `photos`/`videos` with `processing` (any status `pending` and `uploadedAt` older than `STUCK_PROCESSING_HOURS = 12`), plus `metadata`/`thumbnails`/`encoding` failure counters.
- `listForReprocess(kind, limit, offset)` — `{ id, userId, fileId }` for non-trashed assets of a kind, oldest first + `total`.
- `getOrphanCounts()` — raw SQL UNION over `assets.fileId`, `assets.transcodeFileId`, `asset_thumbnails.fileId`; `FileRecord`s older than 10 minutes not referenced → `orphanFiles`; thumbnails whose `fileId` is not in the referenced file set and older than the cutoff → `orphanThumbnails`.

`AdminMaintenanceController` endpoints:

- `GET  api/v1/admin/orphan-counts`
- `POST api/v1/admin/cleanup-orphans` → `bullMq.enqueue('cleanup-orphans', 'cleanup-orphans', {})` → `{ enqueued: true }`
- `POST api/v1/admin/thumbnails/reprocess` (body `{ kind: 'photo' | 'video' }`) → pages assets 500 at a time and calls `enqueueThumbnails(id, fileId, userId, 'thumb-reprocess')` (4 sizes each) → `{ enqueued, totalAssets }`

## Flow

Admin Bearer JWT → global `JwtAuthGuard` (verify + admin role) → (maintenance only) `AdminGuard` → service → Postgres. Maintenance writes nothing itself: it hands work to BullMQ (`cleanup-orphans`; `process-thumbnail` with `thumb-reprocess-<assetId>-<size>` jobIds).

## Integration

- Consumers live in worker-service (`cleanup-orphans.processor.ts`, `thumbnail.processor.ts`).
- Wire types `AdminAssetCountsResponse`, `AdminAssetReprocessListResponse`, `AssetFailureCounts` from `@photox/shared-types`; the web admin dashboard consumes these endpoints and combines `asset-stats` with the users list.
- `AdminGuard` from `src/auth/`, `BullMqService` from `src/queue/`.
