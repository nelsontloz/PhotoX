# PhotoX — Agent Notes

Personal photo/video hosting. One NestJS `core` API (the only HTTP app; when external exposure is needed, a reverse proxy sits in front of it — not part of this repo) + one BullMQ `worker-service` + Vite `web`, sharing Redis and local-disk storage, plus a single Postgres DB owned exclusively by `core`. (No MinIO, no multi-DB — old docs claiming those are stale.)

## Layout

- `apps/core/` (`@photox/core`, :3000, no published port in compose) — the sole API app: auth, assets, files, albums, shares, faces/persons, trash, admin
- `apps/worker-service/` (`@photox/worker-service`, internal-only, no published port) — BullMQ consumers only (7 queues); no DB access: all reads/writes go through core HTTP via `CoreClient`, storage bytes go directly to `STORAGE_DIR`
- `apps/web/` (`@photox/web`, :5173) — Vite + React, talks to core only (same-origin `/api`)
- `apps/core/src/database/` — TypeORM entities + core-only `DatabaseModule` (folded in from the deleted `packages/data-access`)
- `packages/shared-config/` — zod `loadEnv()`/`loadAuthEnv()`/`loadRootEnvFile()` + `LocalStorageService`; `packages/shared-types/` — wire interfaces + `JwtPayload` + `FACE_EMBEDDING_DIM` (folded in from the deleted `packages/shared-auth`)
- `docker-compose.yml` is infra-only: `postgres` (pgvector image, single `photox` DB) + `redis`, both publishing their ports for host `pnpm dev`. App containers live in `docker-compose.e2e.yml` (self-contained `core`/`worker-service`/`web` with build + env), used only by `e2e/run.sh`; only its `web` publishes a port (`E2E_WEB_PORT`, random per run). No compose service is used by `pnpm dev`.

## Commands

```bash
docker compose up -d postgres redis   # infra FIRST; there is no minio service
pnpm dev                              # turbo persistent: core + worker + web
pnpm --filter @photox/core dev           # single package (@photox/core | @photox/worker-service | @photox/web)
pnpm verify                           # lint && test --force && typecheck && build && test:e2e (no pact stages)
curl localhost:3000/health            # core (host dev); compose publishes no core port
```

Node 22 (`.nvmrc`), pnpm 9.15.0 (`packageManager`). After pulling: `pnpm install`, then compose, then `pnpm dev`.

## Env / config

- `packages/shared-config/src/env.ts` (`loadEnv`, zod): `API_PORT` 3000, `CORE_URL` (worker → core, default `http://localhost:3000`, compose `http://core:3000`), `POSTGRES_*` (core only)/`REDIS_*` (localhost defaults), `REDIS_PASSWORD` (optional, no default — integration tests use passwordless testcontainers Redis; compose and `.env.example` default it to `photox_dev`, compose redis runs `--requirepass`, and core/worker/health clients send it when set), `STORAGE_DIR` (default `./data/storage`, anchored at workspace root — core and worker run with different cwds), `AUTH_ACCESS_TTL` 30m, `AUTH_REFRESH_TTL` 30d, `AUTH_CLOCK_TOLERANCE_SEC` 60.
- `loadAuthEnv` (same file): `AUTH_TOKEN_SECRET` required, ≥32 chars. Core uses it to verify; worker also needs it (compose passes it) to mint delegated per-job JWTs for `CoreClient`.
- No `@nestjs/config`: each `app.module.ts` calls `loadRootEnvFile()` (Node's native `process.loadEnvFile`, workspace-root `.env`) before module wiring; existing process env wins, so compose/CI are untouched. `WORKER_SERVICE_PORT` stays a direct `process.env` read in worker `main.ts` (intentionally not in the zod schema). Same precedent: `FACE_DETECTOR` (only `scrfd` selects SCRFD, anything else → `human`) and `FACE_DETECTOR_MODEL_PATH` (default `STORAGE_DIR/models/det_10g.onnx`) are direct reads exposed via shared-config's `envFaceDetectorKind()`/`resolveFaceDetectorModelPath()` — core uses them for the env fallback/model check, the worker for detection.
- The e2e compose stack shares one `storage-data` volume at `/data/storage`; local dev uses `./data/storage`.

## API conventions

- Controllers serve `api/v1/...` directly (e.g. `@Controller('api/v1/assets')`). Public share at `api/share/:token`. Health is unversioned (`health`, 200 even when degraded). No global prefix.
- `apps/core/src/main.ts` (mandatory, keep in sync): `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` + `HttpExceptionFilter` + Swagger `/docs` + `/docs-json`. No CORS on core (browsers reach it same-origin through the Vite dev proxy or a reverse proxy). Worker `main.ts` is intentionally bare.
- DTOs live next to controllers with class-validator decorators; the wire interface lives in `shared-types`.

## Auth

- `argon2` (core dependency only — never add bcrypt). HS256 access JWT + opaque rotated refresh token.
- `JwtPayload` is `{ sub, email, role, iat, exp, jti? }`.
- Global `JwtAuthGuard` (`apps/core/src/auth/jwt-auth.guard.ts`) verifies the Bearer HS256 token (clock tolerance `AUTH_CLOCK_TOLERANCE_SEC`), sets `req.user`, and ignores incoming identity headers entirely. Open routes (`apps/core/src/auth/open-routes.ts`): `/docs*`, `/health`, `api/v1/auth*`, `api/share*`, `GET /api/v1/files/:fileId/stream`. `api/v1/admin*` requires the admin role, enforced centrally by the guard.

## Jobs (BullMQ over Redis)

- Publisher: `apps/core/src/queue/bullmq.service.ts` (typed `enqueueThumbnails`/`enqueueVideo` + generic `enqueue`). Consumers: `QueueModule.onModuleInit()` starts 7 workers: `process-thumbnail`, `process-video`, `process-metadata`, `process-faces`, `process-faces-cluster`, `cleanup-asset`, `cleanup-orphans`. `FaceProcessor` auto-enqueues `process-faces-cluster` (worker→Redis only; the cluster job itself still runs in the worker).
- The worker has **no DB access** — every read/write is a core HTTP call through `apps/worker-service/src/core/core-client.service.ts` (`getFile`, `getAsset`, `patchMetadata`, `registerFile`, `registerThumbnail`, `registerFaces`, `deleteAssetFaces`, `getFacesForCluster`, `getAssetsByIds`, `applyClusters`, `adminDeleteFile`, `adminRunOrphanCleanup`). Each call mints a per-job delegated JWT with the shared `AUTH_TOKEN_SECRET` (`role: 'user'` for media jobs; `role: 'admin'` with `sub: 'worker-service'` for the two cleanup queues), so core's `JwtAuthGuard` scopes the request by the job's user. 400/404/422 → `UnrecoverableError` (no retry); 401/403 → plain error (retried); network/429/5xx retried in-process 3× (1/2/4s) then thrown to BullMQ.
- Dedup/retry: thumbnails `jobId: '<prefix>-<assetId>-<size>'` over `sm/md/lg/xl`, attempts 3 exponential backoff; video `jobId: 'video-<assetId>'` (or `video-reprocess-*`), attempts 3.
- Worker runtime-validates every consumed job payload with zod (`job-schemas.ts`); invalid payloads throw `UnrecoverableError` (no retries). Ownership is enforced core-side by the delegated token; thumbnail/video/metadata/face processors additionally assert the fetched file/asset DTOs match the job's `userId`/`assetId`/`fileId` and throw `UnrecoverableError` on mismatch. `cleanup-asset` carries only `{ fileId }`, so it is shape-validated only and proxies to admin `DELETE /api/v1/admin/files/:fileId`; `cleanup-orphans` proxies to `POST /api/v1/admin/cleanup-orphans/run` (inline scan in core).
- Redis trust model: the worker mints a JWT for whatever `userId`/role a job payload implies, so a compromised Redis lets an attacker act as any user over core's HTTP API (admin included, via the cleanup queues). That is the same blast radius as the pre-decoupling direct Postgres access — no privilege escalation beyond it.
- Video (`video.processor.ts`): reads source from local disk via `LocalStorageService` (no presigned URLs). h264+aac → skip, mark `ready`. Else single pass to AV1 webm (`libaom-av1 -crf 32 -cpu-used 6`, `libopus 96k`), capped 720p, registered via core `POST /api/v1/files/register` as a separate `FileRecord` (`purpose: 'transcode'`); originals immutable. Limits: 4h duration, 7680px, 1h ffmpeg timeout.
- Faces: worker detector facade — `human` (`@vladmandic/human` boxes+mesh only, faceres off; mesh-failed faces rejected, 5 landmarks from mesh means) or `scrfd` (InsightFace SCRFD-10G `det_10g.onnx`, canonical top-left black-pad 640px letterbox + anchor/kps decode feeding the same ArcFace alignment). The per-job `detector` payload wins; otherwise the persisted `app_settings` setting (`face.detector`, admin `GET/PUT api/v1/admin/face-detection`) overrides the `FACE_DETECTOR` env default at enqueue time. Detection runs on an EXIF-auto-oriented ≤2048px copy, `<40px` faces skipped; InsightFace `buffalo_l` `w600k_r50.onnx` **512-dim** embeddings via `onnxruntime-node` (`FACE_EMBEDDING_DIM`; both models provisioned under `STORAGE_DIR/models` by `pnpm --filter @photox/worker-service face-model`, never committed). `faces.detector` records which detector produced each embedding (null = pre-provenance). HNSW index `faces_embedding_hnsw` built at core bootstrap, warn-caught. Detection, embedding and in-memory DBSCAN `eps=0.35 minPts=2` (noise reassign `0.30`, centroid matching `0.30` + `0.05` runner-up margin, O(n²) — fine for personal libraries) all stay in the worker; results are written through core (`DELETE`/`POST .../faces`, `POST /api/v1/persons/apply-clusters`). Admin bulk `POST api/v1/admin/faces/reprocess` (re-embed every photo with the current detector; `GET` returns last-run record + queue counts) and `POST api/v1/admin/faces/recluster` (one manual cluster job per distinct user). Models auto-seed on `pnpm install` (skip-if-present); `FACE_MODEL_SKIP=1` skips it.

## DB / storage

- Single `photox` DB (created by the image entrypoint from `POSTGRES_DB`; `docker/postgres/init.sql` installs the `vector` ext) — only core connects to it. `apps/core/src/database/database.module.ts` (`DatabaseModule.forRoot()`): `synchronize: true`, `autoLoadEntities: true`, `retryAttempts: 3, retryDelay: 3000, connectTimeoutMS: 3000` — do not set `retryAttempts: 0`.
- `LocalStorageService` (in `packages/shared-config`): files at `STORAGE_DIR/<storageKey>`, atomic save via tmp+rename (EXDEV-safe copy fallback).
- `HealthService` (core) uses `DataSource.query('SELECT 1')`, not `@InjectRepository()` (avoids `forFeature` coupling); worker health probes Redis only.

## Web

- File routes (`vite-plugin-pages`), `react-router-dom@7`, `zustand`, `axios`. Vite proxies `/api` + `/health` to `VITE_API_URL || http://localhost:3000` (core).
- Dark by default (`<html class="dark">`). Tailwind v4 CSS config (`@import "tailwindcss"` + `@theme` in `app.css`) — no `tailwind.config.*`. Icons: `react-icons/fa6` only.

## Style

- Prettier: no semicolons, single quotes, trailing commas, 100-col, 2-space. Strict TS (`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`). ESLint type-aware (`project: true`) — don't add files it can't typecheck without updating `.eslintrc.cjs`.
- `typescript` + `@types/node` pinned versions in devDeps — never `workspace:*`. Workspace deps use `workspace:*`.
- Deliberate simplifications are marked `ponytail:` with ceiling + upgrade path — keep the convention, don't "clean them up".

## Tests / CI

- Vitest 3, `globals: true`; turbo runs each package's own `test` script (core, worker-service, web, and the `shared-config` shared package).
- Api runs `src/**/*.spec.ts` + `test/integration/**/*.spec.ts`. Integration spins testcontainers `redis:7-alpine` + plain `postgres:16-alpine` (no pgvector — index creation just warns). Needs Docker; on Podman run `DOCKER_HOST=unix://$HOME/.local/share/containers/podman/machine/podman.sock TESTCONTAINERS_RYUK_DISABLED=true pnpm verify` (`TESTCONTAINERS_RYUK_DISABLED` already in `turbo.json` passthrough). Worker integration tests are Redis-only (fake `CoreClient`, no Postgres).
- Consumer pact: `apps/web/test/pact/consumer/core.pact.spec.ts` (consumer `web` → provider `core`) writing `pacts/web-core.json` (~41 interactions, all web→core calls). It runs inside `verify` because it's a plain vitest spec. Provider verification exists but is opt-in only: `pnpm --filter @photox/core test:pact:provider` (`test/pact/core.provider.spec.ts` via `vitest.pact.config.ts`) — not part of `verify`. No coverage script; don't resurrect the old pact pipeline (the old `worker-service-*.json` pacts are deleted).
- Jenkins (k8s pod): `install --frozen-lockfile` → build `packages/*` → parallel typecheck/lint/test (dind, pulls pg+redis images) → build.

## Security / audit

- Accepted exception in `pnpm audit`: `tar` (critical) + `adm-zip` (high) inside `@tensorflow/tfjs-node@4.22.0` (latest; pins `tar ^6.2.1`, `adm-zip ^0.5.2`). Only reachable at install time (`@mapbox/node-pre-gyp` extracts the official libtensorflow tarball) and in tfjs-node's unused `scripts/resources.js` — never from HTTP or job payloads. Upgrade path: swap the face-detector backend to pure `@tensorflow/tfjs` (much slower faces) or vendor a fork.
- The pnpm in use here **silently ignores all override mechanisms** (`pnpm.overrides` in package.json is warned-and-ignored, `overrides`/`packageExtensions`/`patchedDependencies` in `pnpm-workspace.yaml` and `pnpmfile.cjs` are no-ops — verified empirically). Transitive fixes must come from bumping the parent package.

## Stale-doc warning

Prefer `docker-compose.yml` + `apps/` layout over prose anywhere in the repo (including `README.md`, recently refreshed but still the shallowest source).
