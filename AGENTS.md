# PhotoX — Agent Notes

Personal photo/video hosting. One NestJS `core` + one BullMQ `worker-service` + Vite `web` + stateless NestJS `gateway` (sole exterior API surface), sharing a single Postgres DB, Redis, and local-disk storage. (No MinIO, no multi-DB — old docs claiming those are stale.)

## Layout

- `apps/core/` (`@photox/core`, :3000, internal-only, no published port) — all HTTP: auth, assets, files, albums, shares, faces/persons, trash, admin
- `apps/gateway/` (`@photox/gateway`, :3001, sole exterior port) — stateless JWT verify + fetch-pipe proxy to core, no DB/queue
- `apps/worker-service/` (`@photox/worker-service`, internal-only, no published port) — BullMQ consumers only, writes Postgres directly
- `apps/web/` (`@photox/web`, :5173) — Vite + React, talks to gateway only (same-origin `/api`)
- `packages/data-access/` — TypeORM entities, `SharedDatabaseModule`, `LocalStorageService`
- `packages/shared-auth/` — `JwtPayload`, `loadAuthEnv()`; `packages/shared-config/` — zod `loadEnv()`; `packages/shared-types/` — wire interfaces
- `docker-compose.yml` services: `postgres` (pgvector image, single `photox` DB), `redis`, `core`, `worker-service`, `web`, `gateway`. Only `gateway` (:3001) + `web` (:5173) publish ports, plus `postgres`/`redis` for host `pnpm dev`.

## Commands

```bash
docker compose up -d postgres redis   # infra FIRST; there is no minio service
pnpm dev                              # turbo persistent: core + worker + web
pnpm --filter @photox/gateway dev        # single package (@photox/core | @photox/worker-service | @photox/web | @photox/gateway)
pnpm verify                           # lint && test --force && typecheck && build (no pact stages)
curl localhost:3001/health            # via gateway; core :3000 is internal-only
```

Node 22 (`.nvmrc`), pnpm 9.15.0 (`packageManager`). After pulling: `pnpm install`, then compose, then `pnpm dev`.

## Env / config

- `packages/shared-config/src/env.ts` (`loadEnv`, zod): `API_PORT` 3000, `GATEWAY_PORT` 3001, `CORE_BASE_URL` (default `http://localhost:3000`), `WORKER_SERVICE_PORT` 3004, `POSTGRES_*`/`REDIS_*` (localhost defaults), `STORAGE_DIR` (default `./data/storage`, anchored at workspace root — core and worker run with different cwds), `AUTH_ACCESS_TTL` 30m, `AUTH_REFRESH_TTL` 30d, `AUTH_CLOCK_TOLERANCE_SEC` 60.
- `packages/shared-auth/src/env.ts` (`loadAuthEnv`): `AUTH_TOKEN_SECRET` required, ≥32 chars.
- Compose shares one `storage-data` volume at `/data/storage`; local dev uses `./data/storage`.

## API conventions

- Controllers serve `api/v1/...` directly (e.g. `@Controller('api/v1/assets')`) — exterior traffic goes through the gateway proxy (`@All('/api/*splat')`, Express 5 named splat). Public share at `api/share/:token`. Health is unversioned (`health`, 200 even when degraded). No global prefix.
- `apps/core/src/main.ts` (mandatory, keep in sync): `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` + `HttpExceptionFilter` + `requestIdMiddleware` + Swagger `/docs` + `/docs-json`. No CORS on core (browsers never hit it). Gateway keeps the same conventions plus CORS for `localhost:5173` only. Worker `main.ts` is intentionally bare.
- DTOs live next to controllers with class-validator decorators; the wire interface lives in `shared-types`.

## Auth

- `argon2` (core dependency only — never add bcrypt). HS256 access JWT + opaque rotated refresh token.
- Edge auth: `GatewayAuthGuard` (gateway, stateless verify via `loadAuthEnv` secret, HS256/exp/60s tolerance) enforces JWT on everything except the open table (`/docs*`, `/health`, `api/v1/auth/*`, `api/share/*`, `GET :fileId/stream`) + admin-only on all `api/v1/admin/*`; `GatewayIdentityGuard` (core global) rebuilds `req.user` from `x-user-*` headers, Bearer ignored.
- `JwtPayload` is `{ sub, email, role, iat, exp, jti? }`.
- Proxy strips client `userId` (query + JSON body; multipart: query only) and attaches `x-user-id/email/role` from the verified JWT. Pipe, never buffer: multipart up (1h timeout), GET downloads (300s), Range/206/416 preserved, `x-request-id` propagated, core-down → 502.

## Jobs (BullMQ over Redis)

- Publisher: `apps/core/src/queue/bullmq.service.ts` (typed `enqueueThumbnails`/`enqueueVideo` + generic `enqueue`). Consumers: `QueueModule.onModuleInit()` starts 7 workers: `process-thumbnail`, `process-video`, `process-metadata`, `process-faces`, `process-faces-cluster`, `cleanup-asset`, `cleanup-orphans`. `FaceProcessor` auto-enqueues `process-faces-cluster`.
- Dedup/retry: thumbnails `jobId: '<prefix>-<assetId>-<size>'` over `sm/md/lg/xl`, attempts 3 exponential backoff; video `jobId: 'video-<assetId>'` (or `video-reprocess-*`), attempts 3.
- Video (`video.processor.ts`): reads source from local disk via `LocalStorageService` (no presigned URLs). h264+aac → skip, mark `ready`. Else single pass to AV1 webm (`libaom-av1 -crf 32 -cpu-used 6`, `libopus 96k`), capped 720p, registered as separate `FileRecord` (`purpose: 'transcode'`); originals immutable. Limits: 4h duration, 7680px, 1h ffmpeg timeout.
- Faces: `@vladmandic/human` boxes+mesh only (faceres off), InsightFace `buffalo_l` `w600k_r50.onnx` **512-dim** embeddings via `onnxruntime-node` (`FACE_EMBEDDING_DIM`, model provisioned under `STORAGE_DIR/models`, never committed). HNSW index `faces_embedding_hnsw` built at core bootstrap, warn-caught. In-memory DBSCAN `eps=0.55 minPts=2`, noise reassign `0.5`, centroid matching, O(n²) — fine for personal libraries.

## DB / storage

- Single `photox` DB (`docker/postgres/init.sql` creates DB + `vector` ext). `SharedDatabaseModule.forRoot()`: `synchronize: true`, `autoLoadEntities: true`, `retryAttempts: 3, retryDelay: 3000, connectTimeoutMS: 3000` — do not set `retryAttempts: 0`.
- `LocalStorageService`: files at `STORAGE_DIR/<storageKey>`, atomic save via tmp+rename (EXDEV-safe copy fallback).
- `HealthService` uses `DataSource.query('SELECT 1')`, not `@InjectRepository()` (avoids `forFeature` coupling).

## Web

- File routes (`vite-plugin-pages`), `react-router-dom@7`, `zustand`, `axios`. Vite proxies `/api` + `/health` to `VITE_API_URL || http://localhost:3001` (gateway).
- Dark by default (`<html class="dark">`). Tailwind v4 CSS config (`@import "tailwindcss"` + `@theme` in `app.css`) — no `tailwind.config.*`. Icons: `react-icons/fa6` only.

## Style

- Prettier: no semicolons, single quotes, trailing commas, 100-col, 2-space. Strict TS (`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`). ESLint type-aware (`project: true`) — don't add files it can't typecheck without updating `.eslintrc.cjs`.
- `typescript` + `@types/node` pinned versions in devDeps — never `workspace:*`. Workspace deps use `workspace:*`.
- Deliberate simplifications are marked `ponytail:` with ceiling + upgrade path — keep the convention, don't "clean them up".

## Tests / CI

- Vitest 3, `globals: true`. Workspace (`vitest.workspace.ts`): api, worker-service, web, gateway, 3 shared packages, `scripts` — `data-access` is excluded (no test script).
- Api runs `src/**/*.spec.ts` + `test/integration/**/*.spec.ts`. Integration spins testcontainers `redis:7-alpine` + plain `postgres:16-alpine` (no pgvector — index creation just warns). Needs Docker; on Podman run `TESTCONTAINERS_RYUK_DISABLED=true pnpm verify` (key already in `turbo.json` passthrough).
- Only pact left is `apps/web/test/pact/consumer/` (consumer `web` → provider `gateway`, legacy names) writing root `pacts/`. No provider verification, no coverage script, not part of `verify` — don't resurrect the old pact pipeline.
- Jenkins (k8s pod): `install --frozen-lockfile` → build `packages/*` → parallel typecheck/lint/test (dind, pulls pg+redis images) → build.

## Stale-doc warning

`README.md` still references `minio` and gateway/user-service/media/file-storage ports. Trust `docker-compose.yml` + `apps/` layout over prose.
