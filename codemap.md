# Repository Atlas: PhotoX

## Project Responsibility

Personal photo/video hosting platform. One NestJS `core` API holds every domain; one stateless
NestJS `gateway` is the sole exterior API surface; one BullMQ `worker-service` executes asynchronous
media work; one Vite + React `web` SPA is the browser surface. All processes share a single Postgres
(pgvector) database, Redis, and local-disk storage.

## System Entry Points

- `package.json` — pnpm workspace root scripts (`dev`, `verify`, `build`, `lint`, `typecheck`, `test`); `postinstall` seeds the InsightFace ONNX model.
- `turbo.json` — task graph (`build`/`test`/`lint`/`typecheck` depend on `^build`) + global env passthrough.
- `tsconfig.base.json` — strict TS baseline (`noUncheckedIndexedAccess`, `noUnusedLocals`, NodeNext).
- `vitest.workspace.ts` — workspace test projects (api, worker-service, web, gateway, 3 shared packages, scripts); `data-access` excluded.
- `docker-compose.yml` — full stack: postgres (pgvector), redis, core, worker-service, web, gateway.
- `Jenkinsfile` — CI: frozen install → build `packages/*` → parallel typecheck/lint/test → build.
- `apps/core/src/main.ts`, `apps/gateway/src/main.ts`, `apps/worker-service/src/main.ts`, `apps/web/src/main.tsx` — per-app bootstraps.
- `.slim/codemap.json` — codemap change-detection state (gitignored); regenerate with the codemap skill, not by hand.

## Runtime Topology

```
browser ──/api──▶ gateway :3001 ──HTTP──▶ core :3000 ──▶ Postgres / Redis / STORAGE_DIR
   web :5173         │ (JWT verify, x-user-* identity)      │ enqueue (BullMQ)
                     └── open: /health, /docs*, api/v1/auth/*, api/share/*, GET :fileId/stream
                                                              ▼
                                       worker-service ──consumes 7 queues──▶ Postgres / STORAGE_DIR
```

The gateway is stateless (no DB/queue deps) and is the only service publishing an exterior port
alongside web. Core trusts gateway-injected `x-user-id/email/role` headers and never parses Bearer
tokens itself.

## Directory Map (Aggregated)

### Applications

| Folder | Responsibility | Map |
|---|---|---|
| `apps/` | Overview of the four deployable apps | [apps/codemap.md](apps/codemap.md) |
| `apps/core/` | `@photox/core` internal NestJS API (:3000) owning all HTTP domains | [apps/core/codemap.md](apps/core/codemap.md) |
| `apps/gateway/` | Stateless edge API (:3001): JWT verify + fetch-pipe proxy to core | [apps/gateway/codemap.md](apps/gateway/codemap.md) |
| `apps/web/` | Vite + React SPA (:5173), the browser surface | [apps/web/codemap.md](apps/web/codemap.md) |
| `apps/worker-service/` | BullMQ consumers for thumbnails, video, metadata, faces, cleanup | [apps/worker-service/codemap.md](apps/worker-service/codemap.md) |

### apps/core/src (internal API)

| Folder | Responsibility | Map |
|---|---|---|
| `apps/core/src/` | Composition root: `AppModule` wiring + `main.ts` HTTP conventions | [map](apps/core/src/codemap.md) |
| `auth/` | `GatewayIdentityGuard` (global) + opt-in `AdminGuard`; open-route table | [map](apps/core/src/auth/codemap.md) |
| `users/` | Accounts, 4 public auth endpoints, refresh rotation; subfolders: `admin/`, `admin/dto/`, `dto/`, `entities/`, `tokens/` | [map](apps/core/src/users/codemap.md) |
| `admin/` | Cross-user stats, failure counts, orphan detection, maintenance enqueues (`dto/`) | [map](apps/core/src/admin/codemap.md) |
| `albums/` | Album CRUD + asset membership (`dto/`, `entities/`) | [map](apps/core/src/albums/codemap.md) |
| `assets/` | Asset lifecycle: metadata, favorites, soft-delete, thumbnails (`dto/`) | [map](apps/core/src/assets/codemap.md) |
| `faces/` | Face storage (512-dim embeddings) + on-demand crops (`dto/`) | [map](apps/core/src/faces/codemap.md) |
| `files/` | File primitives + upload/stream surface: `user/` (upload, Range streaming), `admin/` (storage-stats), `storage/` (DI) | [map](apps/core/src/files/codemap.md) |
| `persons/` | Named people from face clusters: CRUD, cover, reassignment (`dto/`) | [map](apps/core/src/persons/codemap.md) |
| `shares/` | Public capability-URL sharing: authenticated mgmt + `api/share/:token` (`dto/`, `entities/`) | [map](apps/core/src/shares/codemap.md) |
| `trash/` | Permanent delete / restore of trashed assets | [map](apps/core/src/trash/codemap.md) |
| `common/` | Exception filter + request-id middleware (`filters/`, `middleware/`) | [map](apps/core/src/common/codemap.md) |
| `database/` | TypeORM bootstrap + pgvector/HNSW index lifecycle | [map](apps/core/src/database/codemap.md) |
| `health/` | Unversioned `GET /health` (Postgres + Redis) | [map](apps/core/src/health/codemap.md) |
| `queue/` | BullMQ publisher (`BullMqService`); core never consumes | [map](apps/core/src/queue/codemap.md) |

### apps/gateway/src (edge)

| Folder | Responsibility | Map |
|---|---|---|
| `apps/gateway/src/` | Composition root + bootstrap (CORS for `localhost:5173`, Swagger) | [map](apps/gateway/src/codemap.md) |
| `auth/` | `GatewayAuthGuard`: HS256 verify, open/admin route tables | [map](apps/gateway/src/auth/codemap.md) |
| `proxy/` | `@All('/api/*splat')` pipe-never-buffer proxy to `CORE_BASE_URL` | [map](apps/gateway/src/proxy/codemap.md) |
| `health/` | `GET /health`, reports core reachability | [map](apps/gateway/src/health/codemap.md) |
| `common/` | Error filter + request-id middleware (`filters/`, `middleware/`) | [map](apps/gateway/src/common/codemap.md) |

### apps/web/src (SPA)

| Folder | Responsibility | Map |
|---|---|---|
| `apps/web/src/` | Bootstrap, route assembly, CSS entry | [map](apps/web/src/codemap.md) |
| `api/` | Axios instance (Bearer + 401 refresh-retry) + per-resource modules | [map](apps/web/src/api/codemap.md) |
| `store/` | Zustand stores: auth, timeline signal, thumb cache, upload queue | [map](apps/web/src/store/codemap.md) |
| `hooks/` | Data fetching/grouping + viewer navigation hooks | [map](apps/web/src/hooks/codemap.md) |
| `lib/` | Framework-free helpers: upload pipeline, thumbnails, formatting | [map](apps/web/src/lib/codemap.md) |
| `components/` | App shell, auth gates, gallery/media primitives; subfolders: `AssetViewer/`, `AssetViewer/sections/`, `Timeline/` | [map](apps/web/src/components/codemap.md) |
| `pages/` | File-based routes (timeline, albums, people, places, favorites, trash, shared, admin, auth); subfolders per route | [map](apps/web/src/pages/codemap.md) |

### apps/worker-service/src (async processing)

| Folder | Responsibility | Map |
|---|---|---|
| `apps/worker-service/src/` | Nest module graph + bare bootstrap | [map](apps/worker-service/src/codemap.md) |
| `queue/` | 7 consumer workers, ffmpeg helpers, face detect→embed→cluster pipeline | [map](apps/worker-service/src/queue/codemap.md) |
| `health/` | `GET /health` (Redis PING only) | [map](apps/worker-service/src/health/codemap.md) |

### packages/ (shared libraries)

| Folder | Responsibility | Map |
|---|---|---|
| `packages/` | Workspace overview: shared-config/types → shared-auth → data-access | [map](packages/codemap.md) |
| `packages/data-access/` | Persistence + storage substrate: entities, `SharedDatabaseModule`, `LocalStorageService` | [map](packages/data-access/codemap.md) |
| `packages/shared-auth/` | `JwtPayload` + `loadAuthEnv()` (HS256 secret) | [map](packages/shared-auth/codemap.md) |
| `packages/shared-config/` | Zod `loadEnv()` for all env vars, workspace-root `STORAGE_DIR` anchoring | [map](packages/shared-config/codemap.md) |
| `packages/shared-types/` | Dependency-free wire contract shared with the SPA | [map](packages/shared-types/codemap.md) |

### Operations

| Folder | Responsibility | Map |
|---|---|---|
| `docker/` | Compose/build assets; subfolders: `base-builder/` (CI builder image), `postgres/` (`init.sql`: DB + vector ext) | [map](docker/codemap.md) |
| `scripts/` | Manual maintenance scripts (`migrate-storage-layout.ts`, dry-run by default) | [scripts/codemap.md](scripts/codemap.md) |

## Cross-Cutting Conventions

- **Identity**: gateway verifies JWT and injects `x-user-id/email/role`; core trusts those headers. Open routes are duplicated in `apps/gateway/src/auth/open-routes.ts` and `apps/core/src/auth/`.
- **Jobs**: core publishes via `queue/bullmq.service.ts`; worker-service consumes 7 queues; dedup via deterministic `jobId`s (`<prefix>-<assetId>-<size>`, `video-<assetId>`), attempts 3 with exponential backoff.
- **Storage**: single `LocalStorageService` maps `storageKey` → `STORAGE_DIR/<key>` with atomic tmp+rename (EXDEV-safe); core and worker share the `storage-data` volume.
- **DB**: single `photox` database, `synchronize: true` (no migrations), pgvector HNSW index `faces_embedding_hnsw` rebuilt at core bootstrap.
- **Tests**: Vitest 3 workspace; integration tests use testcontainers (plain Postgres + Redis). `pnpm verify` = lint + test + typecheck + build.
