# apps/worker-service/src/queue/

## Responsibility

The worker-service processing engine: one BullMQ consumer per queue plus the shared Redis connection,
ffmpeg/ffprobe wrappers, metadata extractors, and the face pipeline (detect → align+embed → cluster → persist).
Reads bytes from local disk via `LocalStorageService`; every DB read/write goes through core HTTP
(`CoreClient`); only Redis enqueues (face→cluster hand-off, legacy re-embed) are self-published.

## Design

- `BullMqService`: one shared ioredis connection (`REDIS_HOST`/`REDIS_PORT` plus
  `REDIS_PASSWORD` when set, `maxRetriesPerRequest: null`),
  lazy `Map<string, Queue>` for enqueues, tracked worker list. `enqueue()` logs-and-swallows add failures
  (producers must never fail uploads); `createWorker()` defaults `concurrency: 1` + failed/error logging;
  `onModuleDestroy` closes workers → queues → connection; `isHealthy()` = Redis `PING`.
- `QueueModule` has **no database imports**: it registers `JwtModule.registerAsync` (secret from
  `loadAuthEnv()`), provides `CoreClient` + `LocalStorageService`, and starts **7 workers** in
  `onModuleInit()`: `process-thumbnail`, `process-video`, `process-metadata`, `process-faces`,
  `process-faces-cluster`, `cleanup-asset`, `cleanup-orphans`.
- `CoreClient` (`../core/core-client.service.ts`) is the only DB boundary. Each call signs a per-job
  delegated HS256 JWT (`{ sub, email: 'worker@internal', role }`, TTL `AUTH_ACCESS_TTL`): media jobs
  use `sub = job.userId` + `role: 'user'`; the two cleanup queues use `sub: 'worker-service'` +
  `role: 'admin'`. Core's `JwtAuthGuard` scopes every request by `sub`, so no `userId` is ever trusted
  from a body. Error mapping: 400/404/422 → `UnrecoverableError` (no retry); 401/403 → plain error
  (retried); network/429/5xx retried in-process 3× (1/2/4s) then thrown to BullMQ. Default request
  timeout 30s; the orphan-cleanup call overrides 120s. HTTP methods: `getFile`, `getAsset`,
  `patchMetadata`, `registerFile`, `registerThumbnail`, `registerFaces`, `deleteAssetFaces`,
  `getFacesForCluster`, `getAssetsByIds` (chunks of 100 ids), `applyClusters`, `adminDeleteFile`,
  `adminRunOrphanCleanup`.
- Per-processor HTTP mapping:
  `process-thumbnail` → `getFile`, `getAsset`, `registerFile` (thumbnail), `registerThumbnail`,
  `patchMetadata`; `process-video` → `getFile`, `getAsset`, `registerFile` (transcode),
  `patchMetadata`; `process-metadata` → `getFile`, `getAsset`, `patchMetadata`;
  `process-faces` → `getFile`, `getAsset`, `deleteAssetFaces`, `registerFaces`, `patchMetadata`;
  `process-faces-cluster` → `getFacesForCluster`, `getAssetsByIds`, `applyClusters`;
  `cleanup-asset` → `adminDeleteFile`; `cleanup-orphans` → `adminRunOrphanCleanup`.
- Payloads: thumbnail `{ assetId, fileId, size, userId }`; video `{ assetId, fileId, userId }`; metadata
  `{ assetId, fileId, userId, kind: 'photo' | 'video' }`; faces `{ assetId, fileId, userId,
detector?: 'human' | 'scrfd', reason?: 'initial' | 're-embed' }`; cluster `{ userId, reason? }`;
  cleanup-asset `{ fileId }`; cleanup-orphans `{}` (ignores `dryRun`).
- Every consumed payload is runtime-validated with zod (`job-schemas.ts`, `parseJobData`); invalid data
  throws `UnrecoverableError` (no retries). Ownership is enforced core-side by the delegated token;
  thumbnail/video/metadata/face jobs additionally assert the fetched `FileRecord`/`Asset` DTOs belong
  to the job's `userId` and match its `assetId`/`fileId`, throwing `UnrecoverableError` on mismatch.
  `cleanup-asset` carries only `{ fileId }`, so it is shape-validated only.
- Dedup/retry set by the core publisher: thumbnail `jobId: '<prefix>-<assetId>-<size>'`, video `'video-<assetId>'`/
  `'video-reprocess-<assetId>'`, `attempts: 3` exponential, `removeOnFail: true`; this side rethrows so BullMQ retries;
  face re-embed (admin reprocess) uses `jobId: face-reembed-<assetId>` with `removeOnComplete: true` so a later run re-enqueues completed assets.
- `process-thumbnail` (concurrency 1): sm/md/lg/xl = 150/300/600/1920 px, `fit: 'inside'` (never crop),
  WebP q80 (xl q85). Video branch waits up to 5×1s for `asset.metadataStatus !== 'pending'` for
  orientation/duration (rethrows `UnrecoverableError` immediately on a gone asset), grabs one frame
  (`-noautorotate -ss <25% duration> -vframes 1 image2pipe`), rotates
  then sharp. Saves the derivative bytes itself, then `registerFile` (kind `thumbnail`; core recomputes
  `storageKey`; checksum dedupe can return another row's id — the worker deletes its own now-orphan
  uniquely-keyed copy), `registerThumbnail` upsert on `(assetId, size)`, and patches `thumbnailStatus`
  ready/failed.
- `process-video` (concurrency 1): ffprobe → reject >4h or dimension >7680px; h264 + (no audio or aac) →
  `transcodeStatus: 'ready'`, `transcodeFileId: null`. Else single-pass AV1 `-c:v libaom-av1 -crf 32
-cpu-used 6 -pix_fmt yuv420p`, `-vf scale=-2:min(720\,ih)` only when height >720, `-c:a libopus -b:a 96k`
  only with audio, 1h ffmpeg timeout. Output saved to disk and `registerFile`d as a separate
  `FileRecord` (`kind: 'transcode'`, `assetId` set; dedupe-orphan cleanup as above); originals immutable;
  failure → `transcodeStatus: 'failed'` + `metadata.transcodeError` + rethrow; tmp dirs always removed.
- `process-metadata` (concurrency 1): photos via `exifreader` (`expanded`, `computed`, MPF excluded) →
  `DateTimeOriginal` UTC, make/model/lens, orientation, dimensions, GPS, ISO (`Math.round` — the core DTO
  is `@IsInt`), fNumber, exposureTime, focalLength. Videos via ffprobe → duration/width/height/codec/fps/hasAudio,
  rotation from `tags.rotate`/side-data, QuickTime-iOS make/model/lens, ISO-6709 `location`.
  `metadataStatus` = `ready` if any field non-null else `failed`, patched on error too; raw probe JSON
  not persisted (`metadata: null`); unknown mimes skipped.
- Face pipeline (`face.detector.ts` facade + `face.detector.human.ts` / `face.detector.scrfd.ts` /
  `face.detector.types.ts` → `face.embedder.ts` → `face.processor.ts`): **detect** on a
  ≤2048px (`FACE_MAX_DIM`) EXIF-auto-oriented `inside` resize (`.rotate()`) with a per-job backend:
  `human` (default; `@vladmandic/human` tensorflow backend, `mesh` on with `keepInvalid: false` so
  mesh-failed faces are rejected instead of box-fraction-aligned, `description` off = no faceres,
  `maxDetected: 20`, `rotation: false`; 5 landmarks from mesh means, box-fraction fallback only for
  partial annotations) or `scrfd` (InsightFace SCRFD-10G `det_10g.onnx`, lazily-loaded
  `onnxruntime-node` session; canonical top-left black-pad 640px letterbox then `scrfd.decode.ts`
  anchor/score/kps decode + greedy class-agnostic NMS 0.4, returning the same 5 kps for ArcFace
  alignment). Backend = job payload `detector` else `FACE_DETECTOR` env (`envFaceDetectorKind`,
  default `human`); model path `FACE_DETECTOR_MODEL_PATH` or `STORAGE_DIR/models/det_10g.onnx`
  (`FACE_DETECTOR_MODEL_FILE`); `FaceDetectorService.onModuleInit` preloads the configured default
  and only warns when weights are missing. Boxes smaller than `FACE_MIN_SIZE_PX` (40) are skipped
  before embedding, the rest scaled back to oriented-original coords, `confidence < 0.5` dropped.
  **align+embed**: 5 landmarks → closed-form similarity fit to the
  ArcFace 112×112 template → pure-JS bilinear warp → RGB `(x-127.5)/128` NCHW → `onnxruntime-node`
  InsightFace `w600k_r50.onnx` (CPU) → **512-dim** L2-normalized vector (`FACE_EMBEDDING_DIM` from
  `@photox/shared-types`); model path `FACE_MODEL_PATH` or
  `STORAGE_DIR/models/w600k_r50.onnx` (`pnpm --filter @photox/worker-service face-model`). **persist**:
  unconditional `deleteAssetFaces` → `registerFaces` carrying the resolved `detector` provenance
  (empty detections skip the POST) — retry-safe replace, never before a successful detect; then
  `faceStatus: 'ready'` + `faceCount`; missing model (detector or embedder) warns + sets
  `faceStatus: 'failed'` **without rethrow** (no retry), others patch `failed` + rethrow;
  **hand off**: enqueue cluster `{ userId, reason: 'face-detected' }` via Redis,
  `jobId: cluster-<userId>` + `CLUSTER_DEBOUNCE_MS` (30s) delay — BullMQ ignores same-id jobs while
  waiting/active, so a detection burst collapses into one trailing run; removeOnComplete/Fail,
  attempts 3 exponential.
- `process-faces-cluster` (concurrency 1): fetches faces via `GET /api/v1/faces?includeEmbeddings=true&excludeTrashed=true`
  (core filters trashed assets); ignores `confidence < 0.4` and embeddings ≠ `FACE_EMBEDDING_DIM` (512).
  O(n²) in-memory DBSCAN (cosine `eps 0.35`, `minPts 2`); noise reattaches to the nearest person centroid
  within `0.30`; each cluster centroid matches a person within `0.30` else becomes a create — both
  assignments also require the nearest centroid to beat the runner-up by `CLUSTER_MATCH_MARGIN` 0.05
  (near-ties stay over-split; merging people is curated separately). The whole plan
  is sent as ONE `POST /api/v1/persons/apply-clusters` (both `creates` and `attaches` arrays always sent;
  skipped when empty): core creates persons, assigns `personId`, sets covers and refreshes `faceCount`
  transactionally — atomic, so a re-run re-derives the plan and sees no unassigned faces. A later cluster
  matching an in-run pending create merges into that create (E3 cannot reference a create id; final DB
  state identical). Legacy-dim unassigned faces: assets fetched via `GET /api/v1/assets?ids=...` (chunks
  ≤ `LEGACY_REEMBED_PER_RUN = 100`) and re-enqueued as `process-faces` re-embeds.
- `cleanup-asset` (concurrency 5): thin proxy — validates `{ fileId }` then calls admin
  `DELETE /api/v1/admin/files/:fileId` (deletes blob + row, 204 even when missing, so idempotent).
- `cleanup-orphans` (concurrency 1, no payload): thin proxy — `POST /api/v1/admin/cleanup-orphans/run`
  runs the whole orphan scan inline in core (referenced ids UNION, orphan `FileRecord`s, orphan
  `AssetThumbnail`s, disk-stray walk) with a 120s client timeout; returns
  `{ deletedFiles, deletedThumbnails, deletedStrays }`. The enqueue-only `POST /admin/cleanup-orphans`
  remains the normal trigger.
- `ffmpeg.ts`: `FFMPEG_PATH`/`FFPROBE_PATH` override, else `ffmpeg-static`/`ffprobe-static`. Default timeout 120s
  (video 1h), SIGTERM → SIGKILL after 5s, non-zero exit → error with last 2KB stderr; `runFfprobeJson` = json probe (120s).

## Flow

upload (core) → core enqueues metadata/faces + thumbnail×4 (+ video) → Redis → one job at a time per queue
(cleanup-asset ×5) → bytes from `STORAGE_DIR` → derivatives saved to disk + rows/status registered over core
HTTP → face job enqueues cluster on Redis → cluster applies one atomic plan over core HTTP → status read back
by core/web.

## Integration

- Upstream producer: `apps/core/src/queue/bullmq.service.ts` (`enqueueThumbnails`, `enqueueVideo`) plus
  core's asset module for metadata/faces; jobIds/attempts/backoff are defined there.
- Reaches core at `CORE_URL` (default `http://localhost:3000`, compose `http://core:3000`) with delegated
  per-job JWTs from `@photox/shared-config`; shares Redis and the storage volume with core; `STORAGE_DIR`
  and `LocalStorageService` via `@photox/shared-config`; no Postgres connection
  import. No callbacks — web polls status from core.
- `cleanup-orphans` is enqueued from core's admin maintenance controller (`POST /api/v1/admin/cleanup-orphans`); `cleanup-asset` has no core producer today (reachable only through the generic `enqueue`).
- Tests: unit specs next to sources (`job-schemas.spec`, `face.cluster.spec`, `face.processor.spec`,
  `face.embedder.spec`, `face.detector.spec`, `scrfd.decode.spec`, `metadata.extractor.spec`,
  `ffmpeg.spec`, `metadata.processor.spec`, `thumbnail.processor.spec`, `video.processor.spec`)
  plus `../core/core-client.service.spec`; `test/integration/*` runs against testcontainers Redis
  only with the fake `CoreClient` from `test/fake-core-client.ts` (face providers lazy so Alpine CI
  skips TF/ONNX).
