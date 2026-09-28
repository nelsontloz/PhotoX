# Repository Atlas: PhotoX

## Project Responsibility

Personal photo/video hosting platform. One NestJS `core` API holds every domain and is the sole API
app; one BullMQ `worker-service` executes asynchronous
media work; one Vite + React `web` SPA is the browser surface. Core owns the single Postgres
(pgvector) database; all processes share Redis and local-disk storage, and the worker reaches the DB
only over core's HTTP API (`CoreClient`, per-job delegated JWT). External exposure, when needed, is
a reverse proxy in front of core — not part of this repo.

## System Entry Points

- `package.json` — pnpm workspace root scripts (`dev`, `verify`, `build`, `lint`, `typecheck`, `test`); `postinstall` seeds the InsightFace ONNX model.
- `turbo.json` — task graph (`build`/`test`/`lint`/`typecheck` depend on `^build`) + global env passthrough.
- `tsconfig.base.json` — strict TS baseline (`noUncheckedIndexedAccess`, `noUnusedLocals`, NodeNext).
- `vitest.workspace.ts` — workspace test projects (api, worker-service, web, 4 shared packages, scripts).
- `docker-compose.yml` — full stack: postgres (pgvector), redis, core, worker-service, web.
- `Jenkinsfile` — CI: frozen install → build `packages/*` → parallel typecheck/lint/test → build.
- `apps/core/src/main.ts`, `apps/worker-service/src/main.ts`, `apps/web/src/main.tsx` — per-app bootstraps.
- `.slim/codemap.json` — codemap change-detection state (gitignored); regenerate with the codemap skill, not by hand.

## Runtime Topology

```
browser ──/api──▶ web :5173 (Vite dev proxy) ──HTTP──▶ core :3000 ──▶ Postgres / Redis / STORAGE_DIR
                      │ (Bearer JWT via global JwtAuthGuard)  │ enqueue (BullMQ)
                      └── open: /health, /docs*, api/v1/auth*, api/share*, GET /api/v1/files/:fileId/stream
                                                              ▼
                                       worker-service ──consumes 7 queues──▶ Redis / STORAGE_DIR
                                                            └──HTTP (CoreClient, per-job JWT)──▶ core
```

Core publishes no port in compose (host dev reaches it at :3000) and its global `JwtAuthGuard`
verifies Bearer HS256 tokens, sets `req.user`, and ignores incoming identity headers. Admin routes
(`api/v1/admin/*`) require role `admin`, enforced centrally by the same guard.

## Directory Map (Aggregated)

### Applications

| Folder                 | Responsibility                                                                                     | Map                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/`                | Overview of the three deployable apps                                                              | [apps/codemap.md](apps/codemap.md)                               |
| `apps/core/`           | `@photox/core` NestJS API (:3000) owning all HTTP domains                                          | [apps/core/codemap.md](apps/core/codemap.md)                     |
| `apps/web/`            | Vite + React SPA (:5173), the browser surface                                                      | [apps/web/codemap.md](apps/web/codemap.md)                       |
| `apps/worker-service/` | BullMQ consumers (thumbnails, video, metadata, faces, cleanup); no DB — core HTTP via `CoreClient` | [apps/worker-service/codemap.md](apps/worker-service/codemap.md) |

### apps/core/src (internal API)

| Folder           | Responsibility                                                                                                                   | Map                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `apps/core/src/` | Composition root: `AppModule` wiring + `main.ts` HTTP conventions                                                                | [map](apps/core/src/codemap.md)          |
| `auth/`          | `JwtAuthGuard` (global): Bearer HS256 verify, open/admin route tables; opt-in `AdminGuard`                                       | [map](apps/core/src/auth/codemap.md)     |
| `users/`         | Accounts, 4 public auth endpoints, refresh rotation; subfolders: `admin/`, `admin/dto/`, `dto/`, `entities/`, `tokens/`          | [map](apps/core/src/users/codemap.md)    |
| `admin/`         | Cross-user stats, failure counts, orphan detection + cleanup (enqueue & inline run) (`dto/`)                                     | [map](apps/core/src/admin/codemap.md)    |
| `albums/`        | Album CRUD + asset membership (`dto/`, `entities/`)                                                                              | [map](apps/core/src/albums/codemap.md)   |
| `assets/`        | Asset lifecycle: metadata, favorites, soft-delete, thumbnails, `ids` filter (`dto/`)                                             | [map](apps/core/src/assets/codemap.md)   |
| `faces/`         | Face storage (512-dim) + replace/query filters + on-demand crops (`dto/`)                                                        | [map](apps/core/src/faces/codemap.md)    |
| `files/`         | File primitives + upload/register/stream: `user/` (upload, register, Range streaming), `admin/` (stats, delete), `storage/` (DI) | [map](apps/core/src/files/codemap.md)    |
| `persons/`       | Named people from face clusters: CRUD, cover, apply-clusters, reassignment (`dto/`)                                              | [map](apps/core/src/persons/codemap.md)  |
| `shares/`        | Public capability-URL sharing: authenticated mgmt + `api/share/:token` (`dto/`, `entities/`)                                     | [map](apps/core/src/shares/codemap.md)   |
| `trash/`         | Permanent delete / restore of trashed assets                                                                                     | [map](apps/core/src/trash/codemap.md)    |
| `common/`        | Exception filter + request-id middleware (`filters/`, `middleware/`)                                                             | [map](apps/core/src/common/codemap.md)   |
| `database/`      | TypeORM bootstrap + pgvector/HNSW index lifecycle                                                                                | [map](apps/core/src/database/codemap.md) |
| `health/`        | Unversioned `GET /health` (Postgres + Redis)                                                                                     | [map](apps/core/src/health/codemap.md)   |
| `queue/`         | BullMQ publisher (`BullMqService`); core never consumes                                                                          | [map](apps/core/src/queue/codemap.md)    |

### apps/web/src (SPA)

| Folder          | Responsibility                                                                                                    | Map                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `apps/web/src/` | Bootstrap, route assembly, CSS entry                                                                              | [map](apps/web/src/codemap.md)            |
| `api/`          | Axios instance (Bearer + 401 refresh-retry) + per-resource modules                                                | [map](apps/web/src/api/codemap.md)        |
| `store/`        | Zustand stores: auth, timeline signal, thumb cache, upload queue                                                  | [map](apps/web/src/store/codemap.md)      |
| `hooks/`        | Data fetching/grouping + viewer navigation hooks                                                                  | [map](apps/web/src/hooks/codemap.md)      |
| `lib/`          | Framework-free helpers: upload pipeline, thumbnails, formatting                                                   | [map](apps/web/src/lib/codemap.md)        |
| `components/`   | App shell, auth gates, gallery/media primitives; subfolders: `AssetViewer/`, `AssetViewer/sections/`, `Timeline/` | [map](apps/web/src/components/codemap.md) |
| `pages/`        | File-based routes (timeline, albums, people, places, favorites, trash, shared, admin, auth); subfolders per route | [map](apps/web/src/pages/codemap.md)      |

### apps/worker-service/src (async processing)

| Folder                     | Responsibility                                                                | Map                                              |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/worker-service/src/` | Nest module graph + bare bootstrap                                            | [map](apps/worker-service/src/codemap.md)        |
| `core/`                    | `CoreClient`: core HTTP calls with per-job delegated JWT, retry/error mapping | [map](apps/worker-service/src/codemap.md)        |
| `queue/`                   | 7 consumer workers, ffmpeg helpers, face detect→embed→cluster pipeline        | [map](apps/worker-service/src/queue/codemap.md)  |
| `health/`                  | `GET /health` (Redis PING only)                                               | [map](apps/worker-service/src/health/codemap.md) |

### packages/ (shared libraries)

| Folder                    | Responsibility                                                                  | Map                                      |
| ------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| `packages/`               | Workspace overview: shared-config/types → shared-auth → data-access             | [map](packages/codemap.md)               |
| `packages/data-access/`   | TypeORM entities + `SharedDatabaseModule` (core-only DB substrate)              | [map](packages/data-access/codemap.md)   |
| `packages/shared-auth/`   | `JwtPayload` + `loadAuthEnv()` (HS256 secret)                                   | [map](packages/shared-auth/codemap.md)   |
| `packages/shared-config/` | Zod `loadEnv()` + `LocalStorageService`, workspace-root `STORAGE_DIR` anchoring | [map](packages/shared-config/codemap.md) |
| `packages/shared-types/`  | Wire contracts shared with the SPA + `FACE_EMBEDDING_DIM`                       | [map](packages/shared-types/codemap.md)  |

### Operations

| Folder     | Responsibility                                                                                             | Map                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `docker/`  | Compose/build assets; subfolders: `base-builder/` (CI builder image), `postgres/` (`init.sql`: vector ext) | [map](docker/codemap.md)                 |
| `scripts/` | Manual maintenance scripts (`migrate-storage-layout.ts`, dry-run by default)                               | [scripts/codemap.md](scripts/codemap.md) |

## Cross-Cutting Conventions

- **Identity**: core's global `JwtAuthGuard` verifies the Bearer HS256 token, sets `req.user`, and ignores incoming identity headers; `api/v1/admin/*` is enforced centrally. The open-route table lives in `apps/core/src/auth/open-routes.ts`.
- **Jobs**: core publishes via `queue/bullmq.service.ts`; worker-service consumes 7 queues and does every DB read/write through core HTTP (`CoreClient`, delegated per-job JWT — ownership enforced core-side by the token `sub`); dedup via deterministic `jobId`s (`<prefix>-<assetId>-<size>`, `video-<assetId>`), attempts 3 with exponential backoff.
- **Storage**: single `LocalStorageService` (in `packages/shared-config`) maps `storageKey` → `STORAGE_DIR/<key>` with atomic tmp+rename (EXDEV-safe); core and worker share the `storage-data` volume, and worker writes bytes to disk directly.
- **DB**: single `photox` database, owned exclusively by core, `synchronize: true` (no migrations), pgvector HNSW index `faces_embedding_hnsw` rebuilt at core bootstrap.
- **Tests**: Vitest 3 workspace; core integration tests use testcontainers (plain Postgres + Redis), worker integration tests are Redis-only. `pnpm verify` = lint + test + typecheck + build.
