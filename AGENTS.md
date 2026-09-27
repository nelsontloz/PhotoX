# PhotoX — Agent Notes

Personal photo/video hosting. One NestJS `core` API (the only HTTP app; when external exposure is needed, a reverse proxy sits in front of it — not part of this repo) + one BullMQ `worker-service` + Vite `web`, sharing a single Postgres DB, Redis, and local-disk storage. (No MinIO, no multi-DB — old docs claiming those are stale.)

## Layout

- `apps/core/` (`@photox/core`, :3000, no published port in compose) — the sole API app: auth, assets, files, albums, shares, faces/persons, trash, admin
- `apps/worker-service/` (`@photox/worker-service`, internal-only, no published port) — BullMQ consumers only, writes Postgres directly
- `apps/web/` (`@photox/web`, :5173) — Vite + React, talks to core only (same-origin `/api`)
- `packages/data-access/` — TypeORM entities, `SharedDatabaseModule`, `LocalStorageService`
- `packages/shared-auth/` — `JwtPayload`, `loadAuthEnv()`; `packages/shared-config/` — zod `loadEnv()`; `packages/shared-types/` — wire interfaces
- `docker-compose.yml` services: `postgres` (pgvector image, single `photox` DB), `redis`, `core`, `worker-service`, `web`. Only `web` (:5173) publishes a port, plus `postgres`/`redis` for host `pnpm dev`; core and worker-service publish none.

## Commands

```bash
docker compose up -d postgres redis   # infra FIRST; there is no minio service
pnpm dev                              # turbo persistent: core + worker + web
pnpm --filter @photox/core dev           # single package (@photox/core | @photox/worker-service | @photox/web)
pnpm verify                           # lint && test --force && typecheck && build (no pact stages)
curl localhost:3000/health            # core (host dev); compose publishes no core port
```

Node 22 (`.nvmrc`), pnpm 9.15.0 (`packageManager`). After pulling: `pnpm install`, then compose, then `pnpm dev`.

## Env / config

- `packages/shared-config/src/env.ts` (`loadEnv`, zod): `API_PORT` 3000, `WORKER_SERVICE_PORT` 3004, `POSTGRES_*`/`REDIS_*` (localhost defaults), `REDIS_PASSWORD` (optional, no default — integration tests use passwordless testcontainers Redis; compose and `.env.example` default it to `photox_dev`, compose redis runs `--requirepass`, and core/worker/health clients send it when set), `STORAGE_DIR` (default `./data/storage`, anchored at workspace root — core and worker run with different cwds), `AUTH_ACCESS_TTL` 30m, `AUTH_REFRESH_TTL` 30d, `AUTH_CLOCK_TOLERANCE_SEC` 60.
- `packages/shared-auth/src/env.ts` (`loadAuthEnv`): `AUTH_TOKEN_SECRET` required, ≥32 chars.
- Compose shares one `storage-data` volume at `/data/storage`; local dev uses `./data/storage`.

## API conventions

- Controllers serve `api/v1/...` directly (e.g. `@Controller('api/v1/assets')`). Public share at `api/share/:token`. Health is unversioned (`health`, 200 even when degraded). No global prefix.
- `apps/core/src/main.ts` (mandatory, keep in sync): `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` + `HttpExceptionFilter` + `requestIdMiddleware` + Swagger `/docs` + `/docs-json`. No CORS on core (browsers reach it same-origin through the Vite dev proxy or a reverse proxy). Worker `main.ts` is intentionally bare.
- DTOs live next to controllers with class-validator decorators; the wire interface lives in `shared-types`.

## Auth

- `argon2` (core dependency only — never add bcrypt). HS256 access JWT + opaque rotated refresh token.
- `JwtPayload` is `{ sub, email, role, iat, exp, jti? }`.
- Global `JwtAuthGuard` (`apps/core/src/auth/jwt-auth.guard.ts`) verifies the Bearer HS256 token (clock tolerance `AUTH_CLOCK_TOLERANCE_SEC`), sets `req.user`, and ignores incoming identity headers entirely. Open routes (`apps/core/src/auth/open-routes.ts`): `/docs*`, `/health`, `api/v1/auth*`, `api/share*`, `GET /api/v1/files/:fileId/stream`. `api/v1/admin*` requires the admin role, enforced centrally by the guard (`AdminGuard` still exists on some controllers as redundant defence).

## Jobs (BullMQ over Redis)

- Publisher: `apps/core/src/queue/bullmq.service.ts` (typed `enqueueThumbnails`/`enqueueVideo` + generic `enqueue`). Consumers: `QueueModule.onModuleInit()` starts 7 workers: `process-thumbnail`, `process-video`, `process-metadata`, `process-faces`, `process-faces-cluster`, `cleanup-asset`, `cleanup-orphans`. `FaceProcessor` auto-enqueues `process-faces-cluster`.
- Dedup/retry: thumbnails `jobId: '<prefix>-<assetId>-<size>'` over `sm/md/lg/xl`, attempts 3 exponential backoff; video `jobId: 'video-<assetId>'` (or `video-reprocess-*`), attempts 3.
- Worker runtime-validates every consumed job payload with zod (`job-schemas.ts`); invalid payloads throw `UnrecoverableError` (no retries). Thumbnail/video/metadata/face processors also enforce ownership before per-file mutations (`userId`/`assetId` match on the loaded record + asset); `cleanup-asset` carries only `{ fileId }`, so it is shape-validated only.
- Video (`video.processor.ts`): reads source from local disk via `LocalStorageService` (no presigned URLs). h264+aac → skip, mark `ready`. Else single pass to AV1 webm (`libaom-av1 -crf 32 -cpu-used 6`, `libopus 96k`), capped 720p, registered as separate `FileRecord` (`purpose: 'transcode'`); originals immutable. Limits: 4h duration, 7680px, 1h ffmpeg timeout.
- Faces: `@vladmandic/human` boxes+mesh only (faceres off), InsightFace `buffalo_l` `w600k_r50.onnx` **512-dim** embeddings via `onnxruntime-node` (`FACE_EMBEDDING_DIM`, model provisioned under `STORAGE_DIR/models`, never committed). HNSW index `faces_embedding_hnsw` built at core bootstrap, warn-caught. In-memory DBSCAN `eps=0.55 minPts=2`, noise reassign `0.5`, centroid matching, O(n²) — fine for personal libraries. Model auto-seeds on `pnpm install` (skip-if-present); `FACE_MODEL_SKIP=1` skips it.

## DB / storage

- Single `photox` DB (created by the image entrypoint from `POSTGRES_DB`; `docker/postgres/init.sql` installs the `vector` ext). `SharedDatabaseModule.forRoot()`: `synchronize: true`, `autoLoadEntities: true`, `retryAttempts: 3, retryDelay: 3000, connectTimeoutMS: 3000` — do not set `retryAttempts: 0`.
- `LocalStorageService`: files at `STORAGE_DIR/<storageKey>`, atomic save via tmp+rename (EXDEV-safe copy fallback).
- `HealthService` uses `DataSource.query('SELECT 1')`, not `@InjectRepository()` (avoids `forFeature` coupling).

## Web

- File routes (`vite-plugin-pages`), `react-router-dom@7`, `zustand`, `axios`. Vite proxies `/api` + `/health` to `VITE_API_URL || http://localhost:3000` (core).
- Dark by default (`<html class="dark">`). Tailwind v4 CSS config (`@import "tailwindcss"` + `@theme` in `app.css`) — no `tailwind.config.*`. Icons: `react-icons/fa6` only.

## Style

- Prettier: no semicolons, single quotes, trailing commas, 100-col, 2-space. Strict TS (`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`). ESLint type-aware (`project: true`) — don't add files it can't typecheck without updating `.eslintrc.cjs`.
- `typescript` + `@types/node` pinned versions in devDeps — never `workspace:*`. Workspace deps use `workspace:*`.
- Deliberate simplifications are marked `ponytail:` with ceiling + upgrade path — keep the convention, don't "clean them up".

## Tests / CI

- Vitest 3, `globals: true`. Workspace (`vitest.workspace.ts`): api, worker-service, web, 4 shared packages, `scripts` — including `data-access`, which now has a test script.
- Api runs `src/**/*.spec.ts` + `test/integration/**/*.spec.ts`. Integration spins testcontainers `redis:7-alpine` + plain `postgres:16-alpine` (no pgvector — index creation just warns). Needs Docker; on Podman run `TESTCONTAINERS_RYUK_DISABLED=true pnpm verify` (key already in `turbo.json` passthrough).
- Only pact left is `apps/web/test/pact/consumer/core.pact.spec.ts` (consumer `web` → provider `core`) writing `pacts/web-core.json`. No provider verification, no coverage script, not part of `verify` — don't resurrect the old pact pipeline.
- Jenkins (k8s pod): `install --frozen-lockfile` → build `packages/*` → parallel typecheck/lint/test (dind, pulls pg+redis images) → build.

## Security / audit

- Accepted exception in `pnpm audit`: `tar` (critical) + `adm-zip` (high) inside `@tensorflow/tfjs-node@4.22.0` (latest; pins `tar ^6.2.1`, `adm-zip ^0.5.2`). Only reachable at install time (`@mapbox/node-pre-gyp` extracts the official libtensorflow tarball) and in tfjs-node's unused `scripts/resources.js` — never from HTTP or job payloads. Upgrade path: swap the face-detector backend to pure `@tensorflow/tfjs` (much slower faces) or vendor a fork.
- The pnpm in use here **silently ignores all override mechanisms** (`pnpm.overrides` in package.json is warned-and-ignored, `overrides`/`packageExtensions`/`patchedDependencies` in `pnpm-workspace.yaml` and `pnpmfile.cjs` are no-ops — verified empirically). Transitive fixes must come from bumping the parent package.

## Stale-doc warning

`README.md` still references `minio` and user-service/media/file-storage services. Trust `docker-compose.yml` + `apps/` layout over prose.

## Repository Map

A full codemap is available at `codemap.md` in the project root.

Before working on any task, read `codemap.md` to understand:

- Project architecture and entry points
- Directory responsibilities and design patterns
- Data flow and integration points between modules

For deep work on a specific folder, also read that folder's `codemap.md`.
