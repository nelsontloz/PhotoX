# PhotoX

Personal photo and video hosting. `core` (NestJS, :3000) is the only public/business HTTP API and the sole owner of Postgres. `worker-service` (NestJS, :3004, unpublished) runs 8 BullMQ consumers, exposes `GET /health` only, and has no DB driver — every read/write is a `core` HTTP call. `web` is a Vite/React SPA (:5173) that talks to core same-origin through `/api`. Core and worker-service share Redis (queues, rate limits, health pings) and `STORAGE_DIR` on local disk (originals, derivatives, upload-session chunks, model weights, GeoNames cache). Media bytes stay on local disk; per-user backups are the only thing that leaves it, written to S3-compatible object storage (Floci in dev).

## Architecture

[![How PhotoX fits together](docs/diagrams/architecture.svg)](docs/diagrams/architecture.html)

## Upload processing

[![How PhotoX processes an uploaded asset](docs/diagrams/data-flow.svg)](docs/diagrams/data-flow.html)

## Features

- **Library** — timeline browsing, albums, favorites, trash, share links, places. Places are asset columns filled by offline GeoNames reverse geocoding during metadata processing; there is no places API (`pnpm --filter @photox/core places:import` seeds the table).
- **Uploads** — per-user SHA-256 dedupe fast-path, optional `STORAGE_QUOTA_BYTES`, and two front doors: legacy multipart `POST /api/v1/files` (used by `web`) and resumable `api/v1/uploads` sessions (8 MiB chunks, 4 GiB max, ≤5 active, 24h pending TTL). Over-quota originals are rejected with 413 before the original is stored.
- **Processing** — thumbnails (`sm/md/lg/xl`, 150/300/600/1920px, WebP), EXIF/video metadata + 9×8 dHash, AV1/Opus WebM transcode (h264 with AAC or no audio skips it; downscaled only above 720p; 4h/7680px inputs, 1h ffmpeg timeout), SCRFD-10G face detection + 512-dim ArcFace embeddings + DBSCAN clustering into People, PaddleOCR v6-small, YOLO26n detections, SigLIP2 768-dim vision embeddings.
- **Search** — pgvector ANN over the 768-dim embeddings plus Postgres full-text over title/description/OCR text/detection labels, fused with RRF; person/place routing, duplicates and similar-photo lookups.
- **Backups** — admin per-user backup/restore to S3-compatible storage, incremental via a `manifest.json` written last; delete, merge previous-account snapshots, prefix sync on email change, overview/progress.
- **Admin console** — five tabs: Overview, AI Pipelines (faces reprocess/recluster, embeddings, detections, OCR), Assets & Maintenance (thumbnail reprocess, orphan sweep), Users (edit, backup-prefix sync, async delete), Backups (overview, progress, backup/restore/merge/delete). Metadata reprocess and places backfill are API-only.

## Prerequisites

- Node.js 22 (`.nvmrc`)
- pnpm 9.15 (see `packageManager`)
- Docker & Docker Compose

## Quick Start

```bash
# Install dependencies (root postinstall loops all 4 worker model scripts; FACE_MODEL_SKIP=1 to skip)
pnpm install

# Configure env, then re-diff .env against .env.example after every pull (new required keys land there)
cp .env.example .env
# Required: AUTH_TOKEN_SECRET + WORKER_JWT_SECRET (>= 32 chars each, must differ; both need entropy).
# Notables: AUTH_TOKEN_SECRET_PREVIOUS (rotation), REDIS_PASSWORD (photox_dev),
# CORE_URL, WORKER_SERVICE_PORT, FACE_DETECTOR_MODEL_PATH, AUTH_* TTLs, RATE_LIMIT_REGISTER,
# STORAGE_QUOTA_BYTES, S3_*/AWS_* (backup storage).

# Start infrastructure (postgres + redis + floci, the local S3 that backs backups)
docker compose up -d postgres redis floci

# Run all apps in dev mode (hot reload)
pnpm dev

# Open the web app
open http://localhost:5173
```

Infrastructure only: `docker-compose.yml` runs `postgres` + `redis` + `floci` (S3-compatible store for backups, `127.0.0.1:4566`) and no app containers (host dev reaches core at `:3000` directly). The e2e stack (`docker-compose.e2e.yml`, driven by `pnpm test:e2e`) merges over it and adds containerized `core`, `worker-service` and `web`; only `web` publishes a port (`E2E_WEB_PORT`). Postgres, Redis and Floci are unpublished there, and the worker mounts the host `./data/storage/models` read-only (model weights must be on the host before an e2e run).

## Commands

| Command                    | What it does                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                 | core + worker-service + web with hot reload                                                            |
| `pnpm build`               | build all packages                                                                                     |
| `pnpm test` / `test:watch` | unit + integration tests (integration shares two reused Testcontainers — Docker must be running)         |
| `pnpm lint` / `typecheck`  | ESLint (type-aware) / `tsc --noEmit` across all packages                                               |
| `pnpm format`              | Prettier write                                                                                         |
| `pnpm test:e2e`            | boot the self-contained e2e stack, then run the Playwright/BDD suite (report: `e2e/playwright-report`) |
| `pnpm verify`              | CI order: lint → `test --force` → typecheck → build → `E2E_BUILD=1 test:e2e`                           |

Single app: `pnpm --filter @photox/core dev` (also `@photox/worker-service`, `@photox/web`); any package script accepts the same `--filter`.

Integration tests share **two reused Testcontainers containers** (`pgvector/pgvector:0.8.7-pg16` + `redis:7-alpine`, plus one Redis for the worker's run) instead of starting a pair per spec file. The global setup bakes a template database once (pgvector/cube/earthdistance + the schema) and each spec file clones it into a private database and claims a private Redis logical DB, so isolation is unchanged. Containers are labelled `photox.test=*`, survive the run so the next one skips the image start, and are wiped at the start of every run — a crashed run cannot leak a database, a schema or a rate-limit bucket into the next one. To drop them by hand: `docker ps -q --filter label=photox.test | xargs docker rm -f`.

### Flags and env

- `--workers=N` — `pnpm verify --workers=4` / `pnpm test:e2e --workers=4`: Playwright's native worker flag, forwarded by `run.sh` to `playwright test`. It does **not** reach vitest — `pnpm verify` appends the flag to its last command (the e2e step); cap the vitest pool with `VITEST_MAX_FORKS=N` instead. The `suite` project is `fullyParallel` and defaults to 1 worker; the `setup` project (features that mutate global state: face reprocess/recluster and the semantic-upload pipeline) always forces 1 worker, runs first, and `suite` depends on it. The seeded-admin check (core inserts an `ADMIN_EMAIL` admin on boot when none exists) runs in the parallel `suite`.
- `E2E_BUILD=1` — rebuild the `photox-e2e-*` images before booting the stack (`pnpm verify` sets it); without it existing images are reused.
- `E2E_KEEP=1` — keep the stack running after the suite (prints the web URL) and skip artifact cleanup.
- `E2E_PROJECT=` / `E2E_WEB_PORT=` — override the auto-generated compose project / web port. Each invocation is stack-isolated, but `e2e/.features-gen`, `e2e/test-results` and `e2e/playwright-report` are shared between concurrent runs.
- `FACE_MODEL_SKIP=1 pnpm install` — skip the root postinstall loop over all 4 worker model scripts.
- `TESTCONTAINERS_REUSE_ENABLE=false` — opt out of container reuse for the test run: each package starts fresh containers and removes them at teardown (slower, but leaves nothing behind).
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — seed an admin on core bootstrap when no admin exists (open registration only mints `user`); empty disables the seed.
- `pnpm --filter @photox/worker-service <script>` — 4 separate (re)download scripts in `apps/worker-service`: `face-model`, `vision-model`, `ocr-model`, `detect-model` (root `postinstall` loops all four).

Core health check (host dev): `curl localhost:3000/health` (200 even when degraded, with per-dependency status). Worker health: `curl localhost:3004/health` (503 when Redis is down). Swagger UI at `http://localhost:3000/docs`.

## Services

| Service        | Port            | Description                                                                                                                                             |
| -------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core           | 3000            | The only public/business HTTP API (auth, assets, files, uploads, albums, shares, faces/persons, search, backups, admin); sole Postgres owner; S3 client |
| worker-service | 3004 (internal) | `GET /health` only; 8 BullMQ consumers: thumbnail, video, metadata, faces, faces-cluster, embeddings, detect, ocr; no DB driver                         |
| web            | 5173            | React frontend (proxies `/api`, `/worker` and `/health` to core)                                                                                        |
| postgres       | 5432            | PostgreSQL with pgvector/cube/earthdistance (single `photox` DB, 18 tables)                                                                             |
| redis          | 6379            | BullMQ (8 worker queues + 1 core queue), auth rate limits, health pings; no volume, so all of it is transient                                           |
| floci          | 4566            | S3-compatible object store backing per-user backups only (dev/local)                                                                                    |

`core` also runs one BullMQ consumer of its own (`user-delete`, async account deletion) and the inline orphan sweep (`POST /api/v1/admin/cleanup-orphans/run`). `STORAGE_DIR` (default `./data/storage`) is shared by core and worker: `originals/`, `derivatives/thumbnails/`, `derivatives/transcodes/`, `upload-sessions/<userId>/<sessionId>/part-<n>`, `models/` (face/vision/OCR/detect weights) and `geo/` (GeoNames cache for the places import). Core writes originals and session chunks; the worker reads originals/models and writes derivatives.

## Uploads

Two front doors, one ingest path (`persistOriginal` → `createAsset` → enqueue jobs).

| Path                               | Client                  | Behavior                                                                               |
| ---------------------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `POST /api/v1/files` (multipart)   | `web`                   | One request; bytes go to OS temp, then `STORAGE_DIR/originals/<userId>/<fileId>.<ext>` |
| `POST /api/v1/uploads` (resumable) | API clients (not `web`) | Session + 8 MiB parts, assembled on `complete`                                         |

- `POST /api/v1/uploads` creates a session: 8 MiB parts, 4 GiB max, ≤5 active sessions per user, 24h pending TTL. `GET /:id` reports status and received parts. `PUT /:id/parts/:index` stores a raw chunk idempotently (replay returns 204, conflicting bytes 409). `POST /:id/complete` assembles, verifies the SHA-256, dedups, creates the asset and enqueues jobs — an enqueue failure returns 503 `ENQUEUE_FAILED` and the session stays retryable. `DELETE /:id` aborts and removes bytes.
- Session parts live under `STORAGE_DIR/upload-sessions/<userId>/<sessionId>/part-<n>`. A 15-minute sweeper (serialized by a Postgres advisory lock across core instances) expires pending (24h), assembled (6h) and failed sessions and deletes their bytes.
- Both paths dedup per user by SHA-256 before the quota check (`POST /api/v1/files/exists` lets the web client skip a known file). The quota check happens before the original is written to `STORAGE_DIR`; request bytes may already exist (multipart in OS temp, session parts under `STORAGE_DIR`), so a 413 is not "zero disk touched".

## HTTP API

No global prefix; controllers declare `api/v1/...`. Health and docs are unversioned.

| Group           | Routes                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health          | `GET /health`                                                                                                                                                                                         |
| Auth            | `/api/v1/auth/{register,login,refresh,logout}`                                                                                                                                                        |
| Assets          | `/api/v1/assets` (+ `/layout`, `/trashed`); `GET/PATCH /:id`; `POST /:id/{trash,reprocess-thumbnails,reprocess-video}`; `POST /bulk-trash`, `/trashed/:id/restore`; `DELETE /trashed`, `/trashed/:id` |
| Files           | `POST /api/v1/files`, `/files/exists`; `GET /:fileId/{stream,download}`                                                                                                                               |
| Upload sessions | `POST /api/v1/uploads`; `GET/DELETE /:uploadId`; `PUT /:uploadId/parts/:index`; `POST /:uploadId/complete`                                                                                            |
| Albums          | `/api/v1/albums`; `GET/PATCH/DELETE /:id`; `POST /:id/assets`; `DELETE /:id/assets/:assetId`; `GET /:id/assets`                                                                                       |
| Shares          | Owner: `/api/v1/shares` (`POST`/`GET`, `DELETE /:id`). Public: `GET /api/share/:token` (+ `/{stream,assets,assets/:assetId/stream}`)                                                                  |
| Persons / faces | `POST /api/v1/persons/cluster`; `GET /api/v1/persons`, `GET/PATCH /:id`; `GET /api/v1/faces/:id/thumb`, `PATCH /:id/person`                                                                           |
| Search / groups | `GET /api/v1/search?q=`; `GET /api/v1/assets/:id/{duplicates,similar,detections}`                                                                                                                     |
| Admin           | `/api/v1/admin/*` (see Admin setup)                                                                                                                                                                   |
| Worker          | `/worker/*` — 14 job routes, core-internal                                                                                                                                                            |
| Docs            | `/docs`, `/docs-json`                                                                                                                                                                                 |

Open routes are exactly `/docs*`, `/health`, `/api/v1/auth*` and `/api/share*`; everything else needs auth. There is no places route group — places are asset columns resolved during metadata writes and by the admin backfill. OCR text and embeddings have no user routes of their own; they surface through assets and search. Detection labels are readable at `GET /api/v1/assets/:id/detections` (the viewer overlay).

## Security

- Worker → core calls carry a per-job delegated JWT (minted with `WORKER_JWT_SECRET`, always `role: 'user'`, `act` set) plus the `X-Job-Signature` HMAC stamped at enqueue. The signature is computed over `sub:scope`, where scope is the first present of `assetId`, `fileId`, `userId`; replay is therefore confined to that asset (media jobs) or that user (cluster/account-wide jobs), not to the job itself. Fail-closed. A compromised Redis can act as any user over core's HTTP API, never as admin.
- Sessions use two HttpOnly cookies: `photox_access` (HS256 JWT, `Path=/api`, 30m TTL) and `photox_refresh` (opaque token, rotated per use, sha256-hashed at rest, `Path=/api/v1/auth`, 1d idle window with a 7d absolute cap). Reuse revokes the family. Passwords are argon2.
- Rate limits are Redis fixed windows and fail closed (503) when Redis is down: login 5/15m per IP+email, 20/15m per IP, register 10/h (`RATE_LIMIT_REGISTER`), refresh 30/15m.
- Original uploads are checked against per-user `STORAGE_QUOTA_BYTES` after the dedupe fast-path — over quota returns 413 before the original is stored. Video transcodes retry once (`attempts: 2`, each retry can cost ~1h of AV1).
- Worker-minted tokens carry no admin reach: `/worker/*` requires `act`, and `/api/v1/admin*` is admin-role checked centrally.

## Share links

- Re-sharing an asset/album **rotates** the link: a new token is minted and the old URL immediately 404s.
- Share tokens are stored sha256-hashed — plaintext exists only in the create response, so copy the link when you create it (the Shared page re-shares on copy for the same reason).
- New shares expire after 30d. Pre-hash share rows still resolve via a plaintext fallback but never expire — re-share to hash them, attach the 30d expiry, and rotate the URL.
- Historical note only: DBs created before the baseline migration may need `shares.token` widened to `varchar(64)` and a nullable `expiresAt` added by hand. Any DB created by the baseline migration already has both (`token varchar(64)`, `expiresAt`), so no manual step is needed.

## Backups

- Admin-only, per-user: a backup writes the user's DB rows + original bytes under `S3_BACKUP_PREFIX` (default `backups/`); `manifest.json` is written last. Reruns are incremental — unchanged objects are skipped via the previous manifest.
- A restore re-enqueues derivatives (thumbnails, transcodes) for restored originals. A restore under a different email immediately re-homes the S3 prefix and manifest to the restored address (the old prefix is deleted), while a same-email restore leaves them in place; a failed move does not fail the restore — the snapshot stays at the source prefix, the response reports `reassignmentError`, and the next backup completes the move. Keep the admin orphan sweep paused for the whole restore — a mid-restore sweep deletes files the manifest still expects.
- Editing a user's email moves the backup prefix the same way; the Users tab retries a failed move through the backup-sync endpoint.
- Deleting a user wipes their media but never their backup; deleted users' backups stay restorable from the admin Backups tab. A snapshot whose email matches a live account (a re-registered address) is shown on that live row as a previous-account backup and can be merged into it.
- Merge is additive: profile fields are not copied, duplicate originals are deduped by checksum, and album/share links are remapped; shares are preserved when their token is free. A merge moves the source snapshot into the live account's own prefix (union with its existing backup) and deletes the source prefix, so the adopted snapshot is no longer independently restorable — its manifest `userId` is the live account. A `backup_merges` ledger still blocks repeat merges. Keep the admin orphan sweep paused during a merge (same as a restore); quota is enforced unless an operator forces the merge.
- Admin backup surface: `POST /api/v1/admin/backups`, `POST /restores`, `POST /restores/merge`, `DELETE /backups`, `GET /backups/overview`, `/backups/status`, `/backups/progress`.

## Admin setup

Open registration only mints role `user`, so a fresh instance needs an admin one of three ways:

- **A. Env seed** (simplest for compose): set `ADMIN_EMAIL` + `ADMIN_PASSWORD` — core inserts that admin on bootstrap when no admin exists. Empty env disables the seed (dev/CI default).
- **B. CLI recovery** (works even when an admin already exists — it promotes/creates unconditionally): `pnpm --filter @photox/core admin:create` (interactive prompts; `--email=`/`--password=` flags for scripts).
- **C. SQL fallback** (promote an existing user; needs DB access):
  ```sql
  UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
  ```

The `/admin` route has five tabs stored in `?tab=`: Overview, AI Pipelines, Assets & Maintenance, Users, Backups. API-only operations (no UI): `POST /api/v1/admin/metadata/reprocess`, `POST /api/v1/admin/places/backfill`, and `POST /api/v1/admin/thumbnails/reprocess` with `kind: 'video'` (the UI only asks for `photo`). `GET /api/v1/admin/face-detection` is read-only (`{modelAvailable}`).

## Layout

- `apps/core` — NestJS API (`@photox/core`)
- `apps/core/src/uploads` — resumable upload sessions + 15-min sweeper
- `apps/worker-service` — BullMQ consumers (`@photox/worker-service`), no DB access — talks to core over HTTP; `GET /health` on :3004
- `apps/web` — Vite + React (`@photox/web`)
- `apps/core/src/database` — TypeORM entities + migrations + boot SQL (core only)
- `packages/shared-config` / `shared-types` — zod env + local storage, JWT payload/wire types
- `docs/diagrams` — the two README diagrams (self-contained HTML + SVG)
- `e2e` — Playwright + playwright-bdd suite (self-contained container stack, `pnpm test:e2e`)

See `AGENTS.md` for architecture details.
