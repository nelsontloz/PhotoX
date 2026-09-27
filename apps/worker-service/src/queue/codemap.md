# apps/worker-service/src/queue/

## Responsibility

The worker-service processing engine: one BullMQ consumer per queue plus the shared Redis connection,
ffmpeg/ffprobe wrappers, metadata extractors, and the face pipeline (detect → align+embed → cluster → persist).
Reads bytes from local disk via `LocalStorageService`; writes Postgres directly; only face→cluster is self-published.

## Design

- `BullMqService`: one shared ioredis connection (`REDIS_HOST`/`REDIS_PORT` plus
  `REDIS_PASSWORD` when set, `maxRetriesPerRequest: null`),
  lazy `Map<string, Queue>` for enqueues, tracked worker list. `enqueue()` logs-and-swallows add failures
  (producers must never fail uploads); `createWorker()` defaults `concurrency: 1` + failed/error logging;
  `onModuleDestroy` closes workers → queues → connection; `isHealthy()` = Redis `PING`.
- `QueueModule` imports `SharedDatabaseModule.forRoot()` + `TypeOrmModule.forFeature([FileRecord, Asset,
AssetThumbnail, Face, Person])` and starts **7 workers** in `onModuleInit()`: `process-thumbnail`,
  `process-video`, `process-metadata`, `process-faces`, `process-faces-cluster`, `cleanup-asset`, `cleanup-orphans`.
- Payloads: thumbnail `{ assetId, fileId, size, userId }`; video `{ assetId, fileId, userId }`; metadata
  `{ assetId, fileId, userId, kind: 'photo' | 'video' }`; faces `{ assetId, fileId, userId, reason?:
'initial' | 're-embed' }`; cluster `{ userId, reason? }`; cleanup-asset `{ fileId }`; cleanup-orphans `{}` (ignores `dryRun`).
- Every consumed payload is runtime-validated with zod (`job-schemas.ts`, `parseJobData`); invalid data
  throws `UnrecoverableError` (no retries). Thumbnail/video/metadata/face jobs additionally assert
  ownership before per-file mutations: the loaded `FileRecord`/`Asset` must belong to the job's `userId`
  and match its `assetId`/`fileId`. `cleanup-asset` carries only `{ fileId }`, so it is shape-validated only.
- Dedup/retry set by the core publisher: thumbnail `jobId: '<prefix>-<assetId>-<size>'`, video `'video-<assetId>'`/
  `'video-reprocess-<assetId>'`, `attempts: 3` exponential, `removeOnFail: true`; this side rethrows so BullMQ retries;
  face re-embed uses `jobId: face-reembed-<assetId>`.
- `process-thumbnail` (concurrency 1): sm/md/lg/xl = 150/300/600/1920 px, `fit: 'inside'` (never crop),
  WebP q80 (xl q85). Video branch waits up to 5×1s for `asset.metadataStatus !== 'pending'` for
  orientation/duration, grabs one frame (`-noautorotate -ss <25% duration> -vframes 1 image2pipe`), rotates
  then sharp. Stores content-addressed `FileRecord` (sha256 dedupe, `purpose: 'original'`, `assetId: null`)
  - `AssetThumbnail` upsert on `(assetId, size)`; patches `thumbnailStatus` ready/failed.
- `process-video` (concurrency 1): ffprobe → reject >4h or dimension >7680px; h264 + (no audio or aac) →
  `transcodeStatus: 'ready'`, `transcodeFileId: null`. Else single-pass AV1 `-c:v libaom-av1 -crf 32
-cpu-used 6 -pix_fmt yuv420p`, `-vf scale=-2:min(720\,ih)` only when height >720, `-c:a libopus -b:a 96k`
  only with audio, 1h ffmpeg timeout. Output = separate `FileRecord` (`purpose: 'transcode'`, sha256 dedupe,
  `assetId` set), originals immutable; failure → `transcodeStatus: 'failed'` + `metadata.transcodeError` +
  rethrow; tmp dirs always removed.
- `process-metadata` (concurrency 1): photos via `exifreader` (`expanded`, `computed`, MPF excluded) →
  `DateTimeOriginal` UTC, make/model/lens, orientation, dimensions, GPS, ISO, fNumber, exposureTime,
  focalLength. Videos via ffprobe → duration/width/height/codec/fps/hasAudio, rotation from `tags.rotate`/
  side-data, QuickTime-iOS make/model/lens, ISO-6709 `location`. `metadataStatus` = `ready` if any field
  non-null else `failed`, patched on error too; raw probe JSON not persisted (`metadata: null`); unknown mimes skipped.
- Face pipeline (`face.detector.ts` → `face.embedder.ts` → `face.processor.ts`): **detect** on ≤1024px
  `inside` resize with `@vladmandic/human` (tensorflow backend, `mesh` on, `description` off = no faceres,
  `maxDetected: 20`, `rotation: false`); boxes scaled back to original coords, `confidence < 0.5` dropped.
  **align+embed**: 5 landmarks (mesh means, box-fraction fallback) → closed-form similarity fit to the
  ArcFace 112×112 template → pure-JS bilinear warp → RGB `(x-127.5)/128` NCHW → `onnxruntime-node`
  InsightFace `w600k_r50.onnx` (CPU) → **512-dim** L2-normalized vector; model path `FACE_MODEL_PATH` or
  `STORAGE_DIR/models/w600k_r50.onnx` (`pnpm --filter @photox/worker-service face-model`). **persist**:
  one `Face` per detection (`personId: null`) then `faceStatus: 'ready'` + `faceCount`; missing model
  warns + sets `faceStatus: 'failed'` **without rethrow** (no retry), others patch `failed` + rethrow;
  re-embed deletes old faces only after a successful detect; **hand off**: enqueue cluster
  `{ userId, reason: 'face-detected' }`, `jobId: cluster-<userId>-<assetId>-<uuid>`, attempts 3 exponential,
  removeOnComplete/Fail — a fixed id would dedupe against completed Redis jobs.
- `process-faces-cluster` (concurrency 1): non-trashed faces only; ignores `confidence < 0.4` and embeddings
  ≠ `FACE_EMBEDDING_DIM` (512). O(n²) in-memory DBSCAN (cosine `eps 0.55`, `minPts 2`); noise reattaches to
  the nearest person centroid within `0.5`; each cluster centroid matches a person within `0.5` else creates
  `Person` (`name: null`, random `cluster-<uuid>`); `faceCount` recomputed excluding trashed; `coverFaceId` =
  largest box. Legacy-dim unassigned faces enqueue ≤ `LEGACY_REEMBED_PER_RUN = 100` re-embeds per run.
- `cleanup-asset` (concurrency 5): delete storage object then `FileRecord`; missing record no-op;
  storage-delete errors logged but the row is still removed.
- `cleanup-orphans` (concurrency 1, no payload): referenced set = `assets."fileId"` ∪
  `assets."transcodeFileId"` ∪ `asset_thumbnails."fileId"`; orphan = `FileRecord` >10 min old and
  unreferenced (re-checked after scanning); unknown-fileId `AssetThumbnail` rows >10 min old are deleted;
  walks `STORAGE_DIR` removing stray keys with no `FileRecord`, skipping `models/**` and `*.tmp`.
- `ffmpeg.ts`: `FFMPEG_PATH`/`FFPROBE_PATH` override, else `ffmpeg-static`/`ffprobe-static`. Default timeout 120s
  (video 1h), SIGTERM → SIGKILL after 5s, non-zero exit → error with last 2KB stderr; `runFfprobeJson` = json probe (120s).

## Flow

upload (core) → core enqueues metadata/faces + thumbnail×4 (+ video) → Redis → one job at a time per queue
(cleanup-asset ×5) → bytes from `STORAGE_DIR` → rows/status written → face job enqueues cluster → status read back by core/web.

## Integration

- Upstream producer: `apps/core/src/queue/bullmq.service.ts` (`enqueueThumbnails`, `enqueueVideo`) plus
  core's asset module for metadata/faces; jobIds/attempts/backoff are defined there.
- Shares Postgres (entities + `SharedDatabaseModule` from `@photox/data-access`), Redis, and the storage volume
  with core; `STORAGE_DIR` via `@photox/shared-config` `loadEnv()`; no callbacks — web polls status from core.
- `cleanup-asset`/`cleanup-orphans` are enqueued from core's trash/admin flows (core exports `enqueueOrphanCleanup(dryRun)`).
- Tests: `job-schemas.spec`, `face.cluster.spec`, `face.embedder.spec`, `ffmpeg.spec`,
  `metadata.processor.spec`, `thumbnail.processor.spec`, `video.processor.spec`,
  `test/integration/*` (testcontainers Redis+Postgres; face providers lazy so Alpine CI skips TF/ONNX).
