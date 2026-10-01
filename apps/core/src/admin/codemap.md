# apps/core/src/admin/

## Responsibility

Cross-user administrative reads and maintenance triggers: processing-failure counters, orphan detection, queue/inline cleanup and reprocess, plus the persisted face-detector setting and bulk face reprocess/recluster. Mostly read-only against Postgres; writes are the inline orphan cleanup, the `app_settings` upserts (detector choice + reprocess last-run record), and queue side effects.

## Design

`AdminModule` imports `TypeOrmModule.forFeature([Asset, FileRecord, AssetThumbnail])`, `StorageModule` and `SettingsModule`; three controllers:

- `AdminAssetsController` — `GET api/v1/admin/assets/counts`.
- `AdminMaintenanceController` — `@Controller('api/v1/admin')` (orphans, thumbnail reprocess, face reprocess/recluster below).
- `AdminFacesController` — `GET`/`PUT api/v1/admin/face-detection`, delegating to `SettingsService`; `SetFaceDetectorDto` is `@IsIn(FACE_DETECTOR_KINDS)`.

The users listing (`GET api/v1/admin/users`) lives in `users/admin/`, not here. Admin is enforced centrally by the global `JwtAuthGuard` on the `api/v1/admin/*` prefix; there is no controller-level guard.

`AdminAssetsService`:

- `getFailureCounts()` — one grouped query over non-trashed assets returning `photos`/`videos` with `processing` (any status `pending` and `uploadedAt` older than `STUCK_PROCESSING_HOURS = 12`), plus `metadata`/`thumbnails`/`encoding` failure counters.
- `listForReprocess(kind, limit, offset)` — `{ id, userId, fileId }` for non-trashed assets of a kind, oldest first + `total`.
- `getOrphanCounts()` — shared raw UNION (`REFERENCED_FILE_IDS_SQL`: `assets.fileId`, `assets.transcodeFileId`, `asset_thumbnails.fileId`); `FileRecord`s older than 10 minutes not referenced → `orphanFiles`; thumbnails whose `fileId` is not in the referenced file set and older than the cutoff → `orphanThumbnails`.
- `cleanupOrphans()` (worker proxy target, inline) — reuses the same referenced-id/stale-file/orphan-thumb helpers as `getOrphanCounts`, re-queries the referenced set right before deleting, deletes blobs (log-swallow) + `FileRecord` rows, deletes orphan `AssetThumbnail` rows, and walks `STORAGE_DIR` deleting stray keys with no `FileRecord` (skipping `models/**` and `*.tmp`). Returns `{ deletedFiles, deletedThumbnails, deletedStrays }`.

`AdminFacesService`:

- `reprocess()` — resolves the detector once via `SettingsService.getFaceDetector()`, pages non-trashed photos 500 at a time through `listForReprocess`, enqueues `process-faces` `re-embed` with `{ assetId, fileId, userId, reason: 're-embed', detector }` and `jobId: face-reembed-<assetId>` + `removeOnComplete: true` (completed jobs are dropped so a later run re-enqueues the same asset; `enqueued` counts requested jobs, not new Redis entries), records the run (`startedAt/total/enqueued/detector`) under `face.reprocess.lastRun`, returns `{ enqueued, total, detector }`.
- `status()` — last-run record (`null` when never run) + `process-faces` `getJobCounts()`.
- `recluster()` — `SELECT DISTINCT "userId" FROM faces`, one `process-faces-cluster` `cluster` job per user with `jobId: cluster-<userId>-admin-<timestamp>` (unique suffix so a manual run is never deduped against the worker's debounced job), returns `{ enqueued }`.

`AdminMaintenanceController` endpoints:

- `GET  api/v1/admin/orphan-counts`
- `POST api/v1/admin/cleanup-orphans` → `bullMq.enqueue('cleanup-orphans', 'cleanup-orphans', {})` → `{ enqueued: true }` (the normal trigger; the worker proxy calls `run` below)
- `POST api/v1/admin/cleanup-orphans/run` → runs `cleanupOrphans()` inline (no queue) and returns the counts; this is what the worker `cleanup-orphans` consumer proxies to
- `POST api/v1/admin/thumbnails/reprocess` (body `{ kind: 'photo' | 'video' }`) → pages assets 500 at a time and calls `enqueueThumbnails(id, fileId, userId, 'thumb-reprocess')` (4 sizes each) → `{ enqueued, totalAssets }`
- `POST api/v1/admin/faces/reprocess` → `adminFaces.reprocess()`
- `GET  api/v1/admin/faces/reprocess` → `adminFaces.status()`
- `POST api/v1/admin/faces/recluster` → `adminFaces.recluster()`

## Flow

Admin Bearer JWT → global `JwtAuthGuard` (verify + admin role) → service → Postgres / storage. The enqueue endpoints only hand work to BullMQ (`cleanup-orphans`, thumbnail/face reprocess, recluster); the `run` endpoint executes the orphan scan inline for the worker proxy. Face reprocess stamps each job with the detector resolved at run start and writes the last-run record; the detector switch is a plain `app_settings` upsert.

## Integration

- Consumers live in worker-service (`cleanup-orphans.processor.ts`, `thumbnail.processor.ts`, `face.processor.ts`, `face.cluster.ts`): the cleanup queues are thin proxies back to this module's admin endpoints; face reprocess/recluster jobs are consumed by the normal face processors.
- Wire types `AdminAssetCountsResponse`, `AdminAssetReprocessListResponse`, `AssetFailureCounts`, `FaceDetectionSettings`, `FaceDetectorKind` from `@photox/shared-types`; the web admin dashboard consumes the asset-counts/reprocess/orphan-counts/face-detection/faces-reprocess endpoints.
- `BullMqService` from `src/queue/`; `SettingsService` from `src/settings/`.
