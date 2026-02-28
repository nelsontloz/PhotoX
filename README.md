# PhotoX Personal Edition

PhotoX is a web-first, self-hosted photo platform for personal use. It targets practical Google Photos-like workflows with a Docker-first developer setup and a service-oriented architecture.

## What is in this repository

- A Next.js web app (`apps/web`) for auth, upload, and timeline flows.
- Node.js + Fastify backend services (`services/*`) for auth, ingest, and domain APIs.
- A Python FastAPI ML service (`services/ml`).
- Local infrastructure via Docker Compose (Traefik, Postgres + pgvector, Redis, Prometheus, Grafana).
- Implementation docs, contracts, and roadmap under `docs/`.

## Current status snapshot

Implemented now:

- `auth-service`: register, login, refresh, logout, `/me`, OpenAPI + Swagger.
- `ingest-service`: chunked upload lifecycle (`init`, `part`, `complete`, `abort`, status), idempotency support, owner-checksum dedupe for active media, OpenAPI + Swagger.
- `library-service`: timeline API, media detail/flags, soft delete/restore, and authenticated media content endpoint with WebP thumbnail generation.
- `web-app`: `/register`, `/login`, `/upload`, `/timeline` flows, including multi-file upload batches with bounded concurrency (4) and timeline modal high-resolution viewer navigation.

Scaffold/partial services:

- `album-sharing-service`, `search-service`, `worker-service`: health/metrics/docs scaffolding.
- `ml-service`: health/metrics/docs and root scaffold route.

See `docs/11-current-implementation-status.md` for the detailed live snapshot.

## Architecture at a glance

- Frontend: Next.js + React + Tailwind + TanStack Query
- Gateway: Traefik
- Core APIs: Node.js 22 + Fastify
- ML API: Python 3.12 + FastAPI
- Data: PostgreSQL 16 + pgvector
- Queue/Cache: Redis + BullMQ
- Storage: local filesystem volumes for originals/derived media
- Observability: Prometheus + Grafana

See `docs/01-c4-architecture.md` for the full C4 view.

## Repository layout

- `apps/web` - Next.js web UI
- `services/auth` - auth and session APIs
- `services/ingest` - upload lifecycle and media enqueue
- `services/library` - timeline and media APIs
- `services/album-sharing` - albums/sharing API scaffold
- `services/search` - search API scaffold
- `services/worker` - worker scaffold
- `services/ml` - ML FastAPI scaffold
- `infra` - observability and infra config
- `docs` - architecture, roadmap, contracts, and test gates
- `scripts` - helper scripts (including Swagger smoke checks)

## For AI coding agents

This repository is docs-first. Before coding, read `AGENTS.md` and then follow the required docs order under `docs/`.

Quick links:

- `AGENTS.md` - repository-level execution policy for coding agents
- `docs/06-ai-agent-master-runbook.md` - execution and handoff runbook
- `docs/07-ai-agent-task-contracts.md` - task contract schema and global rules
- `docs/08-service-implementation-spec.md` - service/API implementation constraints
- `docs/09-testing-and-quality-gates.md` - mandatory gates and evidence format
- `docs/10-execution-checklists-and-handoffs.md` - completion checklists and handoff template
- `docs/11-current-implementation-status.md` - live implementation snapshot

## Local development quickstart

Prerequisites:

- Docker Engine + Docker Compose v2
- Free ports for your selected `.env` values
- Writable host directories for media storage

1) Copy and edit env file

```bash
cp .env.example .env
```

Set at least:

- `PHOTOX_ORIGINALS_DIR`
- `PHOTOX_DERIVED_DIR`
- `JWT_ACCESS_SECRET` (generate with `openssl rand -hex 32`)
- `JWT_REFRESH_SECRET` (generate with `openssl rand -hex 32`)

Optional helper to generate and save both secrets:

```bash
JWT_ACCESS_SECRET="$(openssl rand -hex 32)"
JWT_REFRESH_SECRET="$(openssl rand -hex 32)"
```

Notes:

- Compose startup now requires explicit JWT values for auth/ingest/library.
- In `NODE_ENV=production`, weak placeholders such as `change-me` are rejected at service startup.

2) Create storage directories

```bash
mkdir -p /absolute/path/to/photox/data/originals /absolute/path/to/photox/data/derived
```

3) Validate compose config

```bash
docker compose --env-file .env config
```

4) Start stack

```bash
docker compose --env-file .env --profile app up -d --build
```

5) Check status

```bash
docker compose --env-file .env ps
```

6) Stop stack

```bash
docker compose --env-file .env down
```

## Development stack with hot reload (new)

This repository now includes a dedicated dev compose file that keeps production compose and Dockerfiles unchanged.

Development artifacts:

- `docker-compose.dev.yml`
- `apps/web/Dockerfile.dev`
- `services/*/Dockerfile.dev`
- `services/ml/Dockerfile.dev`

### First-time setup

1) Create a dev env file:

```bash
cp .env.dev.example .env.dev
```

2) Ensure these are valid in `.env.dev` (or `.env`):

- `PHOTOX_ORIGINALS_DIR`
- `PHOTOX_DERIVED_DIR`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`

3) Create storage directories if needed:

```bash
mkdir -p /absolute/path/to/photox/data/originals /absolute/path/to/photox/data/derived
```

### Start dev stack

Use both env files so `.env.dev` overrides `.env`:

```bash
docker compose \
  -f docker-compose.dev.yml \
  --env-file .env \
  --env-file .env.dev \
  up --build
```

### Stop dev stack

```bash
docker compose \
  -f docker-compose.dev.yml \
  --env-file .env \
  --env-file .env.dev \
  down
```

### Dev behavior details

- Web app runs `npm run dev` in-container with source bind mounts.
- Node services run with `nodemon` for hot reload.
- ML service runs `uvicorn --reload`.
- Each service mounts code from host and uses a container-managed `node_modules` volume to avoid host/container dependency conflicts.
- Services are reachable through Traefik at `http://localhost:${HTTP_PORT:-8088}` and also on direct host dev ports for debugging.

## Default access URLs

These depend on your `.env` values (`HTTP_PORT`, `GRAFANA_PORT`, `PROMETHEUS_PORT`).

- Web app: `http://localhost:<HTTP_PORT>/`
- Auth docs: `http://localhost:<HTTP_PORT>/api/v1/auth/docs`
- Ingest docs: `http://localhost:<HTTP_PORT>/api/v1/uploads/docs`
- Library docs: `http://localhost:<HTTP_PORT>/api/v1/library/docs`
- Albums docs: `http://localhost:<HTTP_PORT>/api/v1/albums/docs`
- Search docs: `http://localhost:<HTTP_PORT>/api/v1/search/docs`
- Worker docs: `http://localhost:<HTTP_PORT>/api/v1/worker/docs`
- ML docs: `http://localhost:<HTTP_PORT>/api/v1/ml/docs`
- Prometheus: `http://localhost:<PROMETHEUS_PORT>`
- Grafana: `http://localhost:<GRAFANA_PORT>`

## Testing

Run tests from each service directory.

Auth service:

```bash
cd services/auth
npm test
```

Ingest service:

```bash
cd services/ingest
npm test
```

Web app:

```bash
cd apps/web
npm test
```

Library service:

```bash
cd services/library
npm test
```

Swagger/OpenAPI smoke checks:

```bash
python3 scripts/smoke_swagger_docs.py

# Contract compatibility checks (service-local npm test workflows)
npm --prefix apps/web test
npm --prefix services/worker test
npm --prefix services/auth test
npm --prefix services/ingest test
npm --prefix services/library test
```

Pact testing behavior:
- `apps/web npm test` runs unit/integration tests, generates HTTP consumer pacts, and publishes pacts to `PACT_BROKER_BASE_URL`.
- `services/worker npm test` runs unit/integration tests, generates message consumer pacts, publishes pacts, and verifies worker provider pacts from broker.
- `services/auth`, `services/ingest`, and `services/library` `npm test` verify provider pacts from broker and publish verification results.

Provider verification note:
- `auth-service`, `ingest-service`, and `library-service` provider verification require a reachable provider URL (defaults to `http://localhost:8088` unless `PACT_*_PROVIDER_BASE_URL` is set).

## Useful documentation

- `docs/01-c4-architecture.md` - system architecture
- `docs/05-local-dev-quickstart.md` - local setup details
- `docs/08-service-implementation-spec.md` - service-level implementation contracts
- `docs/09-testing-and-quality-gates.md` - required quality gates
- `docs/11-current-implementation-status.md` - current implemented endpoints/state
