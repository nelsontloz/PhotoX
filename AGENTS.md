# PhotoX — Agent Notes

Personal photo/video hosting: one NestJS `core` API (the only HTTP app; external exposure goes through a reverse proxy that is not in this repo) + one BullMQ `worker-service` + Vite `web`, sharing Redis, local-disk media (`STORAGE_DIR`), and an S3-compatible object store used only for per-user backups (Floci in dev). Single Postgres DB (`photox`) owned exclusively by `core` — old docs claiming MinIO or multiple DBs are stale.

## Layout

- `apps/core/` (`@photox/core`, :3000, no published port in compose) — the sole API app: auth, assets, files, albums, shares, faces/persons, places, search, backups, trash, admin
- `apps/worker-service/` (`@photox/worker-service`, internal-only) — 9 BullMQ consumers; no DB access: reads/writes go through core HTTP via `CoreClient`, media bytes go directly to `STORAGE_DIR`
- `apps/web/` (`@photox/web`, :5173) — Vite + React, talks to core same-origin via `/api` (a `/worker` proxy exists for e2e; browsers never call it)
- `apps/core/src/database/` — TypeORM entities + core-only `DatabaseModule` + migrations
- `packages/shared-config/` — zod `loadEnv()`/`loadAuthEnv()`/`loadRootEnvFile()`, `LocalStorageService`, backup-path helpers; `packages/shared-types/` — wire interfaces, `JwtPayload`, embedding constants (`FACE_EMBEDDING_DIM` 512, `SEARCH_EMBEDDING_DIM` 768, `SEARCH_EMBEDDING_MODEL` `siglip2-b16-224`)
- `docker-compose.yml` is infra-only: `postgres` (pgvector image, single `photox` DB) + `redis` + `floci` (S3-compatible backup store, `:4566`, no healthcheck); `pnpm dev` runs the apps on the host. `docker-compose.e2e.yml` merges over it via `e2e/run.sh`: adds `core`/`worker-service`/`web` containers, only `web` publishes a port (`E2E_WEB_PORT`, random per run), worker mounts host `./data/storage/models` read-only (models must be on the host).

## Commands

```bash
docker compose up -d postgres redis floci   # infra FIRST (floci only needed for backups)
pnpm dev                                    # turbo persistent: core + worker + web on the host
pnpm --filter @photox/core dev              # single package (@photox/core | @photox/worker-service | @photox/web)
pnpm verify                                 # lint && test --force && typecheck && build && E2E_BUILD=1 test:e2e
curl localhost:3000/health                  # core (host dev); compose publishes no core port
```

Node 22 (`.nvmrc`), pnpm 9.15.0 (`packageManager`). After pulling: `pnpm install` (root `postinstall` downloads all 4 worker models unless `FACE_MODEL_SKIP=1`), diff `.env` against `.env.example` for new required keys, start compose, then `pnpm dev`.

## Env / config

- `packages/shared-config/src/env.ts` (`loadEnv`, zod): `API_PORT` 3000; `CORE_URL` (worker→core, default `http://localhost:3000`, compose `http://core:3000`); `POSTGRES_*` (core only); `REDIS_*` (localhost defaults; `REDIS_PASSWORD` optional — testcontainers Redis is passwordless, compose defaults `photox_dev` and runs `--requirepass`); `STORAGE_DIR` (default `./data/storage`, anchored at workspace root — core and worker have different cwds); `STORAGE_QUOTA_BYTES` (optional; over-quota originals 413 before bytes are written, checked after the dedup fast-path); `S3_*`/`AWS_*` (backups; dev defaults target Floci); `AUTH_ACCESS_TTL` 30m; `AUTH_REFRESH_TTL` 1d (sliding idle window; parsed to **ms** in the schema while `AUTH_ACCESS_TTL` stays a string); `AUTH_CLOCK_TOLERANCE_SEC` 60.
- `loadAuthEnv` (same file): `AUTH_TOKEN_SECRET` + `WORKER_JWT_SECRET` required, each ≥32 chars **and** entropy-checked (≥16 unique chars, no 6-char run); worker secret must differ from the auth secret. `AUTH_TOKEN_SECRET_PREVIOUS` is optional rotation overlap (never signs).
- No `@nestjs/config`: each `app.module.ts` calls `loadRootEnvFile()` (Node `process.loadEnvFile`, root then cwd `.env`; existing process env wins). Direct `process.env` reads instead of zod: `WORKER_SERVICE_PORT`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `FACE_DETECTOR_MODEL_PATH`/`FACE_MODEL_PATH` (detector path via `resolveFaceDetectorModelPath()`, default `STORAGE_DIR/models/det_10g.onnx`), `FFMPEG_PATH`/`FFPROBE_PATH`.
- Turbo 2 strict env: only keys in `turbo.json` `globalPassThroughEnv` reach tasks — add new test/script env there (e.g. the `TESTCONTAINERS_*` vars).

## API conventions

- Controllers declare `api/v1/...`; no global prefix. Health is unversioned (`health`), 200 even when degraded. Public share is `api/share/*` (token + asset/album children).
- `apps/core/src/main.ts` (mandatory, keep in sync): `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` + `HttpExceptionFilter` + Swagger `/docs`/`/docs-json` + static security headers; `trust proxy` 1 is load-bearing for per-IP rate limits; no CORS (browsers reach core same-origin through the Vite dev proxy or a reverse proxy). Worker `main.ts` is intentionally bare.
- DTOs live next to controllers with class-validator; wire interfaces live in `shared-types`.

## Auth

- `argon2` only (never bcrypt). Access = HS256 JWT; refresh = opaque token, sha256-hashed at rest, rotated per use with reuse detection (a reused token revokes the family). Idle window 1d, hard **7d absolute cap**; logout and refresh-reuse bump `users.tokensValidAfter`, which the guard enforces as a session floor.
- `JwtPayload` = `{ sub, email, role, iat, exp, jti?, act? }`. The guard tries **auth secret → `AUTH_TOKEN_SECRET_PREVIOUS` → worker secret** (Bearer wins over cookie), sets `req.user`, and ignores incoming identity headers. `photox_access` HttpOnly cookie (SameSite=Lax, Path=/api, re-minted past half its TTL); the refresh cookie is scoped to `/api/v1/auth`.
- Worker-minted tokens (`act`, signed only with `WORKER_JWT_SECRET`, always `role: 'user'`) are default-denied everywhere except the `/worker/*` job surface — no admin reach. Open routes are exactly `/docs*`, `/health`, `api/v1/auth*`, `api/share*` (file streams are authenticated). `api/v1/admin*` gets the admin role check centrally.
- Job binding: core stamps `sig = HMAC(WORKER_JWT_SECRET, userId:scope)` into each payload at enqueue (scope = first of assetId/fileId/userId); the worker threads it back as `X-Job-Signature` and the guard recomputes/403s — fail-closed, replay confined to that asset, not the jobId. Worker-origin tokens without `act` are 401.
- Rate limits are Redis-backed and **fail closed (503)** on Redis errors (300ms budget): login 5/15m per ip+email, register `RATE_LIMIT_REGISTER` (default 10/h), refresh 30/15m.
- Admins: registration always mints `user`. Seed via `ADMIN_EMAIL`+`ADMIN_PASSWORD` (only when no admin exists) or `pnpm --filter @photox/core admin:create [--email= --password=]` (unconditional).

## Jobs (BullMQ over Redis)

- Publisher: `apps/core/src/queue/bullmq.service.ts`. Worker consumes 9 queues: `process-thumbnail`, `process-video`, `process-metadata`, `process-faces`, `process-faces-cluster`, `process-embeddings`, `process-ocr`, `process-detect`, `cleanup-asset` (each processor self-starts its own worker; no shared bootstrap). Core consumes exactly one queue itself: `user-delete` (async account deletion). Orphan cleanup is inline-only (`POST api/v1/admin/cleanup-orphans/run`; there is no queue or consumer for it), and nothing in-repo enqueues `cleanup-asset` (trash delete returns `fileIds` no one consumes).
- Defaults: `attempts: 3`, exponential backoff, `removeOnFail: true`; video overrides `attempts: 2` (a retry can cost ~1h of SVT-AV1). jobIds are the dedup contract (`thumb*`/`video*` per asset+size, `embed-`/`ocr-`/`detect-` per asset, `face-reembed-`, cluster per user per click, `user-delete-<userId>`); restore re-enqueues are run-tagged because a retained completed jobId silently swallows later runs.
- Worker has **no DB access**: every read/write is a core HTTP call via `apps/worker-service/src/core/core-client.service.ts`; bytes go straight to `STORAGE_DIR`. Each call mints a per-job delegated JWT (`WORKER_JWT_SECRET`, `act`) so core scopes by the job's user. Mapping: 400/404/422 → `UnrecoverableError` (no retry); 401/403/429/5xx/timeout → plain error → BullMQ retries (there is no in-process retry loop).
- Payloads zod-validated (`job-schemas.ts`); invalid payloads → `UnrecoverableError`. Processors assert fetched DTOs match the job's ids; core re-enforces ownership via the token. `cleanup-asset` requires `{assetId, fileId, userId}` and calls `DELETE /worker/files/:fileId`.
- Missing models don't fail jobs: the worker warns, patches a `failed` status where a column exists, and completes (a retry would not help); detect/ocr have no status column (logs only).
- Redis trust model: the worker mints a JWT for whatever `userId` a payload implies, so a compromised Redis lets an attacker act as any user over core's HTTP API (never as admin) — same blast radius as the old direct-Postgres access.
- Video: h264+aac → skip & mark `ready`. Else one SVT-AV1 pass (`libsvtav1 -preset 8 -crf 32`, `libopus 96k` only with an audio track, downscale only >720p) → webm registered through core as a separate `FileRecord` (`purpose: 'transcode'`); originals immutable. Caps: 4h / 7680px / 1h ffmpeg; `transcodeStatus` stays `pending` if the worker dies mid-job.
- Faces: SCRFD-10G is the only detector (`det_10g.onnx`, top-left black-pad 640 letterbox); detection on an EXIF-oriented ≤2048px copy, faces `<40px` skipped; ArcFace `w600k_r50.onnx` **512-dim** embeddings. Detection/embedding/DBSCAN (`eps=0.35`, `minPts=2`, noise reassign `0.30`, centroid `0.30` + `0.05` runner-up margin, O(n²)) stay in the worker; results go through core. No detector provenance anywhere (no job field, setting, or column); `GET api/v1/admin/face-detection` is read-only `{modelAvailable}`. Admin: `POST api/v1/admin/faces/reprocess` (re-detect + re-embed), `POST api/v1/admin/faces/recluster`.
- Other pipelines: OCR (PaddleOCR v6-small, ≤1600px, conf ≥0.5; nothing registered when empty), detect (YOLO26n 640, conf 0.4, top-200, replace-set), embed (SigLIP2 int8, ≤2048px, 768-dim). All models live under `STORAGE_DIR/models`, provisioned by `pnpm --filter @photox/worker-service <face|vision|ocr|detect>-model` (skip-if-present; root postinstall runs all four), never committed; inference loads only from disk (`allowRemoteModels=false`).

## DB / storage

- Single hardcoded `photox` DB; only core connects. `DatabaseModule.forRoot()`: `synchronize: NODE_ENV !== 'production'`, `migrationsRun` in production over `apps/core/src/database/migrations` (Baseline + FileChecksumUnique); **new entity columns need a migration for prod**, and a synchronize-era dev DB must be manually marked migrated before later ones apply. `retryAttempts: 3`, `retryDelay: 3000`, `connectTimeoutMS: 3000` — don't zero them.
- Boot bootstrap SQL (pgvector ext, `assets_layout_idx`, `asset_embeddings_hnsw` halfvec index, cube/earthdistance + places GiST) is warn-only per group — core boots degraded rather than failing; search/places fail at query time.
- `LocalStorageService`: files at `STORAGE_DIR/<storageKey>`, atomic save via tmp+rename (EXDEV-safe copy fallback). E2e shares one `storage-data` volume.
- `HealthService` (core) uses `DataSource.query('SELECT 1')` + a Redis ping, not `@InjectRepository()`; worker health probes Redis only.

## Web

- Explicit lazy routes in `src/App.tsx` (react-router-dom 7 `useRoutes`); zustand stores; axios client is cookie-only (`withCredentials`, no Bearer header) with proactive-refresh + 401-retry interceptors. Vite proxies `/api`, `/worker`, `/health` to `VITE_API_URL || http://localhost:3000`; `/worker` is e2e plumbing only.
- Dark by default (`<html class="dark">`). Tailwind v4 CSS config (`@import "tailwindcss"` + `@theme` in `app.css`) — no `tailwind.config.*`. Icons: `react-icons/fa6` only.
- Media loads through direct stream URLs (`/api/v1/files/:id/stream`, `/api/v1/faces/:id/thumb`) authenticated by the HttpOnly cookie — blob fetching only for the explicit download action.

## Style

- Prettier: no semicolons, single quotes, trailing commas, 100-col, 2-space. Strict TS (`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`). ESLint type-aware (`project: true`) — don't add files it can't typecheck without updating `.eslintrc.cjs`.
- `typescript` + `@types/node` pinned versions in devDeps — never `workspace:*`. Workspace deps use `workspace:*`.
- Deliberate simplifications are marked `ponytail:` with ceiling + upgrade path — keep the convention, don't "clean them up".

## Tests / CI

- Vitest 3 (`globals: true`); turbo runs each package's `test`. Single spec: `pnpm --filter @photox/core test src/path.spec.ts` (vitest forwards path filters). Core has two projects: unit `src/**/*.spec.ts` (5s) and integration `test/integration/**/*.spec.ts` (30s tests / 60s hooks, `retry: 1`).
- Core integration boots per-spec testcontainers `redis:7-alpine` + `pgvector/pgvector:0.8.7-pg16` with vector/cube/earthdistance pre-created; `test-setup.ts` must be imported by helpers (no `setupFiles`). Docker required. Worker integration is Redis-only with a fake `CoreClient`; web tests are colocated jsdom specs (config inline in `vite.config.ts`; `test:browser` is opt-in and not in `verify`); `shared-config` has no vitest config (defaults).
- Podman/macOS: `TESTCONTAINERS_RYUK_PRIVILEGED=true pnpm verify` (the SELinux VM kills unprivileged Ryuk on socket bind). If you set `DOCKER_HOST=unix://$HOME/.local/share/containers/podman/machine/podman.sock`, also set `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`; `TESTCONTAINERS_RYUK_DISABLED=true` opts out. These vars pass through turbo.
- No coverage script. Web→core contract = `shared-types` (compile time) + e2e (runtime); deleted pact specs stay deleted.
- e2e (`pnpm test:e2e` = `e2e/run.sh`) runs a compose stack + playwright-bdd: the `setup` project (`04-faces/**` + `05-semantic/semantic-upload.feature`) runs first, serial; `suite` is parallel and takes `--workers=N`. Flags: `E2E_BUILD=1` (rebuild images), `E2E_KEEP=1`, `E2E_PROJECT`, `E2E_WEB_PORT`. Fixed creds `admin@photox.test`/`password123`. Concurrent runs get their own stack/port but share `e2e/.features-gen`, `test-results`, `playwright-report`.
- Jenkins (k8s pod): install `--frozen-lockfile` → Validate in parallel (typecheck / lint / `pnpm test`, dind pre-pulls `postgres:16-alpine` + `redis:7-alpine`) → `pnpm build`. No e2e stage.

## Security / audit

- The pnpm in use here **silently ignores all override mechanisms** (`pnpm.overrides` in package.json is warned-and-ignored; `overrides`/`packageExtensions`/`patchedDependencies` in `pnpm-workspace.yaml` and `pnpmfile.cjs` are no-ops — verified empirically). Transitive fixes must come from bumping the parent package.

## Stale-doc warning

Prefer executable sources (`docker-compose*.yml`, package.json scripts, code) over prose anywhere in the repo — README is refreshed periodically and is a summary, not the contract.
