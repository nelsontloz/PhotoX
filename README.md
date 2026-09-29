# Photox

Personal photo and video hosting platform: one NestJS API (`core`), one BullMQ worker (`worker-service`), and a Vite/React `web` app, sharing Redis and local-disk storage, with a single Postgres DB owned by `core`.

## Prerequisites

- Node.js 22 (`.nvmrc`)
- pnpm 9.15 (see `packageManager`)
- Docker & Docker Compose

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure env (AUTH_TOKEN_SECRET is required, >= 32 chars)
cp .env.example .env

# Start infrastructure
docker compose up -d postgres redis

# Run all apps in dev mode (hot reload)
pnpm dev

# Open the web app
open http://localhost:5173
```

To run the full stack in containers instead: `docker compose up -d` (only `web` publishes a port).

## Development

```bash
# Run a single app
pnpm --filter @photox/core dev
pnpm --filter @photox/worker-service dev
pnpm --filter @photox/web dev

# Lint + test + typecheck + build
pnpm verify
```

Core health check (host dev): `curl localhost:3000/health`

## Services

| Service        | Port       | Description                                                           |
| -------------- | ---------- | --------------------------------------------------------------------- |
| core           | 3000       | The only HTTP API (auth, assets, files, albums, shares, faces, admin) |
| worker-service | (internal) | BullMQ consumers (thumbnails, video, metadata, faces, cleanup)        |
| web            | 5173       | React frontend (proxies `/api` to core)                               |
| postgres       | 5432       | PostgreSQL (pgvector image; single `photox` DB)                       |
| redis          | 6379       | Redis (BullMQ queues)                                                 |

Storage is local disk (`STORAGE_DIR`, default `./data/storage`) shared by core and worker — no object store.

## Layout

- `apps/core` — NestJS API (`@photox/core`)
- `apps/worker-service` — BullMQ consumers (`@photox/worker-service`), no DB access — talks to core over HTTP
- `apps/web` — Vite + React (`@photox/web`)
- `apps/core/src/database` — TypeORM entities + DB module (core only)
- `packages/shared-config` / `shared-types` — zod env + local storage, JWT payload/wire types

See `AGENTS.md` for architecture details and `codemap.md` for the full repository map.
