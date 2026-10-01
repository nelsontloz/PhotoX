# apps/worker-service/

## Responsibility

Internal-only NestJS app that executes asynchronous media work for PhotoX: thumbnails, video
transcode, EXIF/video metadata extraction, face detect (Human/BlazeFace or SCRFD-10G)/embed/cluster,
and file/disk cleanup. It has **no Postgres access**: every DB read/write is a core HTTP call through
`src/core/core-client.service.ts` (`CoreClient`), while storage bytes go directly to
`STORAGE_DIR`. Compose publishes no port for it; `main.ts` still listens on
`WORKER_SERVICE_PORT` (default 3004) so in-network health probes work.

## Design

- Thin shell by convention: `src/main.ts` boots `AppModule` with no ValidationPipe, exception
  filter, request-id middleware, Swagger, or CORS (unlike `apps/core`). No exterior traffic reaches it.
- `src/app.module.ts` = global `ConfigModule.forRoot({ envFilePath: ['../../.env', '.env'] })` +
  `QueueModule` + `HealthModule`. Worker cwd is `apps/worker-service`, hence the `../../.env` path.
- ALL consumer registration lives in `src/queue/queue.module.ts` `onModuleInit()` — 7 BullMQ workers.
  `HealthModule` re-imports `QueueModule` only to inject the singleton `BullMqService`; Nest module
  dedupe means workers start once.
- `src/core/core-client.service.ts` is the app's only DB boundary: per-call delegated HS256 JWT
  (`AUTH_TOKEN_SECRET`; `role: 'user'` for media jobs, `role: 'admin'` + `sub: 'worker-service'` for
  the two cleanup queues) against `CORE_URL`; 30s request timeout (120s for the inline orphan scan);
  400/404/422 → `UnrecoverableError`, 401/403 → plain error, network/429/5xx → 3 in-process retries
  (1/2/4s) then thrown to BullMQ.
- Build: `nest build` → `dist/`; `tsconfig.build.json` narrows `rootDir` to `src` and excludes
  `test/` + `**/*spec.ts`; `tsconfig.json` (typecheck) includes both `src` and `test`.
- Test: Vitest + `unplugin-swc` (decorators), `globals: true`, 60s test / 120s hook timeouts;
  includes `src/**/*.spec.ts`, `test/**/*.spec.ts`, `test/**/*.pact.spec.ts` (no pact suites here).
  `test/integration/` spins testcontainers Redis only (`test-setup.ts`); the DB is faked with
  `test/fake-core-client.ts`, a stateful in-memory `CoreClient` stand-in.
- `scripts/download-face-model.sh` (`pnpm face-model`) fetches the InsightFace buffalo_l bundle and
  extracts `w600k_r50.onnx` (~174MB) plus the SCRFD `det_10g.onnx` (~17MB) to `STORAGE_DIR/models/`;
  weights are never committed. Detector backend is chosen per job — payload `detector` → `FACE_DETECTOR`
  env (default `human`) — and `faces.detector` records which one produced each embedding.
- Dockerfile: node:22-bookworm-slim multi-stage; on arm64 rebuilds the `@tensorflow/tfjs-node`
  binding from source (no linux-arm64 prebuilt); runtime copies built `packages/*` + app and runs
  `node apps/worker-service/dist/main.js` with `EXPOSE 3004`.
- Heavy native deps are intentional: `sharp`, `ffmpeg-static`/`ffprobe-static`, `exifreader`,
  `@vladmandic/human` + `@tensorflow/tfjs-node`, `onnxruntime-node`. TF/ONNX are lazy-loaded so unit
  tests on musl/Alpine never dlopen them (see `src/queue/codemap.md`).

## Flow

`core` upload path publishes jobs to Redis → worker's 7 long-lived BullMQ consumers pick them up →
source bytes read from local disk via `LocalStorageService` (`STORAGE_DIR`) → derivatives written to
disk → rows and status columns registered/patched through core HTTP (`POST /files/register`,
`POST /assets/:id/thumbnails`, `DELETE`+`POST /assets/:id/faces`, `PATCH /assets/:id/metadata`,
`POST /persons/apply-clusters`). There is no callback/return path beyond these calls; the web UI
observes results by polling status from core. A successful face job auto-enqueues a per-user
clustering job (worker→Redis only). `cleanup-asset`/`cleanup-orphans` are thin proxies to admin
endpoints. `GET /health` reports Redis liveness only.

## Integration

- Consumes from the same Redis as `apps/core/src/queue/bullmq.service.ts` (the producer) with
  jobIds/attempts/backoff/removeOnFail defined on the core side.
- Talks to core over HTTP at `CORE_URL` (default `http://localhost:3000`, compose
  `http://core:3000`), authenticating with per-job delegated JWTs minted from the shared
  `AUTH_TOKEN_SECRET`; core enforces ownership from the token `sub`.
- Shares the storage volume with core: compose `storage-data` at `/data/storage`, local dev
  `./data/storage` (resolved by `@photox/shared-config` `loadEnv`).
- Depends on `@photox/shared-config` (delegated JWT secret via `loadAuthEnv`, `loadEnv`,
  `LocalStorageService`) and `@photox/shared-types`; no Postgres/TypeORM
  dependency and no Postgres connection at runtime.
- No app proxies worker-service; only compose/ops hit its health port.
