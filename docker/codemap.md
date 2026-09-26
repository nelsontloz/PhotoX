# docker/

## Responsibility

Build assets for the containerized stack. The compose file itself lives at the repo root (`docker-compose.yml`); this folder holds the shared Postgres bootstrap (`postgres/init.sql`) and the CI base-builder image (`base-builder/Dockerfile`). Per-app Dockerfiles live under `apps/<name>/Dockerfile` and are referenced by compose.

## Design

Compose topology (`docker-compose.yml`), one bridge network `photox-net`:

- `postgres` — `pgvector/pgvector:0.8.3-pg16-bookworm`, single `photox` DB. Publishes `5432` for host dev; named volume `pgdata` for data; mounts `./docker/postgres/init.sql` into `/docker-entrypoint-initdb.d/`. Healthcheck `pg_isready -U photox` (5s/3s/5 retries).
- `redis` — `redis:7-alpine`, publishes `6379`, healthcheck `redis-cli ping`. BullMQ transport.
- `core` — built from `apps/core/Dockerfile`, context is repo root. Ports not published; `depends_on` postgres+redis (healthy). `/data/storage` from named volume `storage-data`. Healthcheck hits `http://localhost:3000/health`.
- `worker-service` — built from `apps/worker-service/Dockerfile`; shares the same `storage-data` volume at `/data/storage`; depends on postgres+core+redis healthy; healthcheck `:3004/health`.
- `gateway` — built from `apps/gateway/Dockerfile`; publishes `3001` (sole exterior API); `CORE_BASE_URL=http://core:3000`; depends on core healthy.
- `web` — built from `apps/web/Dockerfile`; publishes `5173`; `VITE_API_URL=http://gateway:3001`; depends on gateway healthy. Image runs the Vite dev server (`pnpm dev --host 0.0.0.0`), not a static build.

Only `gateway` and `web` publish ports for normal use; `postgres`/`redis` are published so host-run `pnpm dev` processes can reach them. Core and gateway share one `AUTH_TOKEN_SECRET` (dev literal in compose) — the gateway verifies tokens at the edge, core trusts the forwarded identity headers.

App Dockerfiles are multi-stage: `deps` (workspace manifests only + `pnpm install --frozen-lockfile`), `build` (`tsc`/`nest build` for shared packages then the app), `runtime` (node:22-alpine, copies node_modules + packages + app, `CMD node apps/<app>/dist/main.js`). `apps/core` and `apps/gateway` stay on alpine; `worker-service` uses bookworm-slim and rebuilds `@tensorflow/tfjs-node` from source on arm64. `web` is single-stage.

## Flow

`docker compose up -d postgres redis` first (infra), then `docker compose up --build` for the stack. Entry order is enforced by `depends_on: condition: service_healthy` gates, not just startup order: postgres+redis → core → worker/gateway → web. On first boot, Postgres runs `init.sql` to create the DB and extension; after that the named volumes make it a no-op.

## Integration

- `docker/postgres/init.sql` is the only DB bootstrap; TypeORM `synchronize: true` owns the schema afterwards.
- `storage-data` is the shared filesystem contract between core (writes originals/derivatives) and worker (reads sources, writes transcodes) — same path `/data/storage` in both, backed by `STORAGE_DIR`.
- `docker/base-builder/Dockerfile` is the source for the registry `node-builder` image used by Jenkins; the compose images do not inherit from it.
