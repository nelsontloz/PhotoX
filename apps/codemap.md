# apps/

## Responsibility

Holds the four deployable PhotoX applications. Everything runtime-facing lives here; `packages/` supplies shared code, not services.

- `core/` (`@photox/core`, :3000) — the only app with full HTTP surface: auth, assets, files, albums, shares, faces/persons, trash, admin. Internal-only, no published port in compose.
- `gateway/` (`@photox/gateway`, :3001) — sole exterior API. Stateless: verifies HS256 JWTs, enforces auth/admin route tables, then fetch-pipes `/api/*` to core. No DB, no queue.
- `worker-service/` (`@photox/worker-service`, :3004 health) — BullMQ consumers only (thumbnails, video transcode, metadata, faces/clustering, cleanup). Writes Postgres and storage directly; no public HTTP API.
- `web/` (`@photox/web`, :5173) — Vite + React SPA, talks only to the gateway (Vite proxies `/api` + `/health` to `VITE_API_URL`).

## Design

- pnpm workspace + turbo. Each app is its own package with `build`/`dev`/`lint`/`test`/`typecheck` scripts; turbo orders them and builds `packages/*` first (`dependsOn: ["^build"]`).
- The gateway is deliberately stupid — proxy and edge auth only, so it can be scaled/restarted without state. Core holds all business logic.
- Identity is hop-by-hop: gateway strips any client `userId` and attaches verified `x-user-id/email/role`; core's global `GatewayIdentityGuard` rebuilds `req.user` from those headers and ignores Bearer.
- Core and worker share nothing at runtime except Postgres, Redis, and the storage directory. Core enqueues typed BullMQ jobs; worker consumes and is the only writer for derived files.
- NestJS conventions (ValidationPipe, exception filter, request-id middleware, Swagger) are set up per app `main.ts`; worker's `main.ts` is intentionally bare.

## Flow

1. Browser → gateway `:3001` → (edge JWT check) → core `:3000`; multipart uploads and downloads are piped, never buffered (Range/206 preserved).
2. Core persists metadata via TypeORM and saves originals through `LocalStorageService` under `STORAGE_DIR`, then enqueues BullMQ jobs.
3. Worker picks jobs, reads from local disk, writes derivatives/transcodes/embeddings back to Postgres and storage.
4. Job status and file records flow back to clients on the next core read through the gateway.

## Integration

- Consumes `packages/data-access` (entities, DB module, storage), `packages/shared-auth` (JWT payload/env), `packages/shared-config` (`loadEnv`), `packages/shared-types` (wire interfaces).
- `docker-compose.yml` builds each app from its own `apps/<name>/Dockerfile`; Jenkins runs `pnpm verify` + builds packages in parallel.
- Host dev runs `pnpm dev` (turbo: core + worker + web) with postgres/redis from compose; gateway is started separately.
