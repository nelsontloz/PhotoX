# apps/worker-service/

## Responsibility

Internal-only NestJS app that executes asynchronous media work for PhotoX: thumbnails, video
transcode, EXIF/video metadata extraction, face detect/embed/cluster, and file/disk cleanup. It is
the only process besides `core` that writes Postgres directly. Compose publishes no port for it;
`main.ts` still listens on `WORKER_SERVICE_PORT` (default 3004) so in-network health probes work.

## Design

- Thin shell by convention: `src/main.ts` boots `AppModule` with no ValidationPipe, exception
  filter, request-id middleware, Swagger, or CORS (unlike `apps/core`). No exterior traffic reaches it.
- `src/app.module.ts` = global `ConfigModule.forRoot({ envFilePath: ['../../.env', '.env'] })` +
  `QueueModule` + `HealthModule`. Worker cwd is `apps/worker-service`, hence the `../../.env` path.
- ALL consumer registration lives in `src/queue/queue.module.ts` `onModuleInit()` — 7 BullMQ workers.
  `HealthModule` re-imports `QueueModule` only to inject the singleton `BullMqService`; Nest module
  dedupe means workers start once.
- Build: `nest build` → `dist/`; `tsconfig.build.json` narrows `rootDir` to `src` and excludes
  `test/` + `**/*spec.ts`; `tsconfig.json` (typecheck) includes both `src` and `test`.
- Test: Vitest + `unplugin-swc` (decorators), `globals: true`, 60s test / 120s hook timeouts;
  includes `src/**/*.spec.ts`, `test/**/*.spec.ts`, `test/**/*.pact.spec.ts` (no pact suites here).
  `test/integration/` spins testcontainers Postgres/Redis.
- `scripts/download-face-model.sh` (`pnpm face-model`) fetches the InsightFace buffalo_l bundle and
  extracts only `w600k_r50.onnx` (~174MB) to `STORAGE_DIR/models/`; weights are never committed.
- Dockerfile: node:22-bookworm-slim multi-stage; on arm64 rebuilds the `@tensorflow/tfjs-node`
  binding from source (no linux-arm64 prebuilt); runtime copies built `packages/*` + app and runs
  `node apps/worker-service/dist/main.js` with `EXPOSE 3004`.
- Heavy native deps are intentional: `sharp`, `ffmpeg-static`/`ffprobe-static`, `exifreader`,
  `@vladmandic/human` + `@tensorflow/tfjs-node`, `onnxruntime-node`. TF/ONNX are lazy-loaded so unit
  tests on musl/Alpine never dlopen them (see `src/queue/codemap.md`).

## Flow

`core` upload path publishes jobs to Redis → worker's 7 long-lived BullMQ consumers pick them up →
source bytes read from local disk via `LocalStorageService` (`STORAGE_DIR`) → derivatives written as
new `FileRecord` rows and per-asset status columns (`thumbnailStatus`, `transcodeStatus`,
`metadataStatus`, `faceStatus`) patched in Postgres. There is no callback/return path to core; the
web UI observes results by polling status from core. A successful face job auto-enqueues
a per-user clustering job. `GET /health` reports Redis liveness only.

## Integration

- Consumes from the same Redis as `apps/core/src/queue/bullmq.service.ts` (the producer) with
  jobIds/attempts/backoff/removeOnFail defined on the core side.
- Shares one Postgres (`SharedDatabaseModule`, `synchronize: true`) and one storage volume with core:
  compose `storage-data` at `/data/storage`, local dev `./data/storage` (resolved by
  `@photox/shared-config` `loadEnv`).
- Depends on `@photox/data-access` for entities, database module, and `LocalStorageService`; no
  dependency on core's HTTP surface or web.
- No app proxies worker-service; only compose/ops hit its health port.
