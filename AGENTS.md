# Photox — Agent Notes

Personal photo/video hosting. NestJS microservices monorepo with a Vite React web app.

## Stack

- **Monorepo:** Turborepo + pnpm workspaces (`apps/*`, `packages/*`)
- **Backend:** NestJS 10, TypeORM, PostgreSQL, MinIO, Redis (BullMQ)
- **Frontend:** Vite + React + TypeScript
- **Single PG instance, 3 databases:** `users_db`, `library_db`, `files_db` (see `docker/postgres/init.sql`)
- **Node:** 20 (see `.nvmrc`), **pnpm:** 9.15.0 (see `packageManager` in root `package.json`)

## Async jobs (BullMQ)

The gateway publishes thumbnail and video jobs directly to Redis BullMQ queues (`process-thumbnail`, `process-video`); the worker-service consumes them. There is no longer a `pg-boss` queue, no `worker_db`, and no `/v1/jobs/*` HTTP enqueue endpoint. `BullMqService` in `apps/gateway/src/queue/bullmq.service.ts` (publisher) and `apps/worker-service/src/queue/bullmq.service.ts` (worker registration, with `createWorker(name, processor, opts)`) share the same `REDIS_HOST` / `REDIS_PORT` env (defaults `localhost` / `6379`) declared in `shared-config/src/env.ts`. Thumbnail jobs are deduped via `jobId: 'thumb:<assetId>:<size>'`; video jobs use `attempts: 3` with exponential backoff.

## Video processing

Worker-service uses ffmpeg/ffprobe at runtime and consumes `process-video` jobs from BullMQ. The Docker base-builder installs ffmpeg automatically. For local dev without Docker, install via `apt install ffmpeg` (Debian/Ubuntu) or `brew install ffmpeg` (macOS).

**Pipeline (single-pass, no HLS):** the gateway publishes a `process-video` job after asset creation. The worker downloads the source via a presigned MinIO URL (`ttl=600`), ffprobes the codec, and:

- if video is already `h264` AND (no audio OR audio is `aac`) → skip transcode, set `transcodeStatus='ready'`, return;
- else → single ffmpeg pass to `h264 yuv420p aac 128k -movflags +faststart`, capped at 720p height, then POSTs the bytes to `file-storage-service /v1/files/:fileId/replace` which overwrites the MinIO object at the same storage key. The original upload is always playable immediately; the transcode is an in-place byte optimization.

**Playback:** web `<video src="/api/v1/files/:fileId/stream?userId=...">` hits a `@Public()` gateway route that proxies to `file-storage-service /v1/files/:fileId/stream` (no auth — capability URL model on the trusted network). Range requests are forwarded for seeking.

## Repository layout

```
apps/
  gateway/              NestJS, port 3000 (BFF + BullMQ publisher)
  user-service/         NestJS, port 3001
  media-service/        NestJS, port 3002
  file-storage-service/ NestJS, port 3003
  worker-service/       NestJS, port 3004 (BullMQ worker; no DB)
  web/                  Vite + React, port 5173
packages/
  shared-types/         DTOs (sparse for now)
  shared-auth/          Auth types (JwtPayload, TokenPair)
  shared-config/        Zod env loader (loadEnv)
docker/
  base-builder/Dockerfile  Base image (node 20 + python3 make g++ + pnpm) for CI
  postgres/init.sql        Creates the 3 databases
Jenkinsfile                CI pipeline (k8s pod; testcontainers)
scripts/                   Root tooling (pact-coverage.ts)
docker-compose.yml         9 services: postgres, minio, redis, 5 nestjs, web
```

## Essential commands

```bash
# 1. Start infrastructure FIRST (services need postgres/minio/redis)
docker compose up -d postgres minio redis

# 2. Then start apps
pnpm dev              # runs the 5 backend apps + web in watch mode via turbo (shared packages have no `dev`)
pnpm build            # builds all packages (turbo pipeline)
pnpm typecheck        # tsc --noEmit across packages
pnpm lint
pnpm test             # vitest run across all packages
pnpm test:watch       # vitest watch across all packages
pnpm format           # prettier --write across the repo
pnpm clean            # turbo clean + remove node_modules
pnpm validate         # runs lint via turbo
pnpm verify           # rm -rf pacts && lint && pact-consumer && pact-provider && pact-coverage && test --force && typecheck && build (full pre-commit check)
```

Single package:

```bash
pnpm --filter @photox/user-service dev
pnpm --filter @photox/gateway build
pnpm --filter @photox/user-service test
```

After pulling: `pnpm install` once, then docker compose, then `pnpm dev`.

## tsconfig rules that bite

- Root `tsconfig.base.json` has `experimentalDecorators` + `emitDecoratorMetadata` enabled (NestJS requires these).
- `composite` + `incremental` are set ONLY in the 5 shared package tsconfigs (which use `tsc -b`). They are NOT in the base — NestJS apps use `nest build` (composite breaks it). If a new shared package is added, it must set `composite: true` in its tsconfig or it will build but produce no dist output.
- All NestJS apps have `"@types/node": "^22.0.0"` and `"typescript": "^5.7.0"` in **devDependencies**. Do NOT use `workspace:*` for typescript — it doesn't resolve. Use the version number.

## Testing

- **Runner:** Vitest 3 everywhere (backend + web). Configs: `vitest.workspace.ts` at root lists 10 workspaces (5 apps + web + 3 shared packages + `scripts`); each app/package has its own `vitest.config.ts` with `globals: true` and `passWithNoTests: true`. The web app's vitest config lives inside `vite.config.ts` (single `defineConfig` with a `test` block) because Vite is its only build tool there.
- **Globals are on.** `describe`, `it`, `expect`, `vi` are available without imports. The `tsconfig.vitest.json` at root extends the base and adds `vitest/globals` to `types` for IDE support — point test files at it if your editor complains.
- **Conventions:** `*.spec.ts` co-located with source files for unit tests. Integration tests that spin up testcontainers go in `test/integration/` (e.g. `apps/user-service/test/integration/`). Web tests get `jsdom`; backend/shared tests get `node`.
- **Backend extras installed:** `@nestjs/testing` + `supertest` + `@types/supertest` are devDeps in every backend service for integration tests of controllers.
- **Web extras installed:** `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` are devDeps of `apps/web` for component tests.
- **`passWithNoTests: true`** is set on every vitest config so `pnpm test` succeeds before any test files are written. Remove it once you have real tests and want CI to fail on missing suites.
- **Turbo pipeline:** `test` and `test:watch` tasks in `turbo.json` both `dependsOn: ["^build"]`, so shared packages build first. `test:watch` is `persistent: true`; keep `concurrency: "100%"` at the top of `turbo.json` so turbo allows all persistent watch processes to run.

## NestJS module gotchas (verified the hard way)

**`HealthService` uses `DataSource.query('SELECT 1')`, not `@InjectRepository()`.** A repository injection requires `TypeOrmModule.forFeature()` in the module — too much coupling for a health check. `DataSource` is globally available because the DB `TypeOrmModule.forRoot()` is imported in `AppModule`.

**`file-storage-service` HealthModule must import `StorageModule`** so `MinioService` is in scope. The `HealthService` also pings MinIO directly.

**Gateway has no DB.** Its `HealthService` only checks downstream services via `HttpService` — no `DataSource` injection. It runs its own JWT verification (`PassportModule` + `JwtModule`, passport-jwt, HS256) with a global `APP_GUARD = JwtAuthGuard`; routes can opt out with `@Public()`.

**`worker-service` has no DB.** It does not import `TypeOrmModule`; its `HealthService` only pings Redis via `BullMqService.isHealthy()`. It does not expose any HTTP job enqueue endpoint — jobs arrive via BullMQ only.

**TypeORM config:** Each backend service has `retryAttempts: 3, retryDelay: 3000, connectTimeoutMS: 3000` in `DatabaseModule.forRoot()`. Do NOT set `retryAttempts: 0` — it makes the process crash immediately on connection failure instead of waiting briefly.

## API conventions (apply to all NestJS services)

- **Path versioning lives on the service.** Each backend service exposes its public routes under `/v1/...` declared on the controller, e.g. `@Controller('v1/auth')` in user-service. Do NOT use a global `app.setGlobalPrefix` — keep version routes explicit per controller.
- **Gateway BFF routes live under `api/`.** The gateway exposes `api/services`, `api/v1/auth`, `api/v1/assets`, `api/v1/files`, and `api/v1/videos` via proxy controllers that forward to backend services. `ProxyService` strips hop-by-hop headers, maps downstream 4xx to `HttpException`, 5xx / connection failures to `BadGatewayException` (502). The gateway extracts the user id from the verified JWT (`req.user.id`) and passes it as a query parameter (GET/DELETE) or body field (POST/PATCH) to the backend — it does not send any custom auth headers. The `api/v1/files/:fileId/stream?userId=...` route is marked `@Public()` because the web `<video>` element issues sub-requests for media bytes that don't carry the Authorization header; the path encodes the file id and is treated as a capability URL signed by the gateway session.
- **Health is unversioned.** Each service exposes `GET /health` (no `v1` prefix) because the web app calls it directly on the service port for the status grid.
- **Global pipes & filters are mandatory.** Every `main.ts` must include: `app.useGlobalPipes(new ValidationPipe({ whitelist, forbidNonWhitelisted, transform }))` and `app.useGlobalFilters(new HttpExceptionFilter())`. The shared `HttpExceptionFilter` lives at `apps/<service>/src/common/filters/http-exception.filter.ts`.
- **Validation uses class-validator + class-transformer.** DTOs live next to the controller in `apps/<service>/src/<feature>/dto/*.dto.ts`. `class-validator` and `class-transformer` must be added to the service's `package.json` even though they are optional peers of `@nestjs/common` — do not rely on hoisting.
- **Cross-service request/response shapes live in `shared-types`.** Service-local DTOs may carry class-validator decorators, but the _interface_ that crosses the wire is in `shared-types`. DTOs implement the corresponding `shared-types` interface where one exists (e.g. `RegisterDto`, `LoginDto`, `RefreshDto`, `LogoutDto`, `AuthResponseDto`, `FileRecordDto`, `BatchFilesResponseDto`).
- **CORS lives at the gateway, not on individual services.** Backend services do not call `enableCors()`. Only the gateway does, and only for the web origin(s).
- **Each backend service exposes Swagger UI at `/docs` and the raw OpenAPI JSON at `/docs-json`** (both at the service root, unversioned, always public within `photox-net`). `main.ts` configures `SwaggerModule` with `DocumentBuilder`. Every backend service has a `nest-cli.json` that enables `@nestjs/swagger/plugin` for auto-inference from TS types. Service-local DTOs are decorated with `@ApiProperty` and `implements` the corresponding `shared-types` interface. `shared-types` itself never imports `@nestjs/swagger` — the decorators live in the service.

## Auth

**Password hashing: argon2 only.** Use `argon2` (not bcrypt, not `bcryptjs`). Native binding needs `python3 make g++` in the Docker build stages (`deps` + `build`). If a service does not need passwords (gateway, file-storage), don't add the dep.

**Token model: split.** **Access tokens** are HS256 JWTs (`@nestjs/jwt`), self-describing, locally verifiable, default 30m TTL (`AUTH_ACCESS_TTL`). **Refresh tokens** are opaque, persisted, rotated: 32 random bytes hashed (sha256) and stored in the `refresh_tokens` table with `purpose = 'refresh'` and `expiresAt`. `/refresh` rotates (revokes the old row, issues a new pair). `/logout` revokes the refresh row. A JWT access token cannot be revoked before its `exp` — the refresh token is the only revocation surface.

**Token TTLs and secrets come from env.** `AUTH_ACCESS_TTL` (default `30m`) and `AUTH_REFRESH_TTL` (default `30d`) live in `shared-config/src/env.ts`. `AUTH_TOKEN_SECRET` (required, ≥32 characters) and `AUTH_CLOCK_TOLERANCE_SEC` (default `60`) live in `packages/shared-auth/src/env.ts` via `loadAuthEnv()`, shared by user-service and the gateway.

**Jwt payload shape.** `JwtPayload` in `shared-auth` is `{ sub, email, iat, exp, jti? }`. The gateway's `JwtStrategy` maps `payload.sub` to a request user of `{ id, email }` and passes `id` as a query/body parameter to backend services.

## Service-to-service communication: trust the network

**No guards, no `x-user-id` header, no `/v1/internal/` path prefix.** Backend services trust the network boundary. The gateway is the only auth surface.

### How identity flows

- **User requests (gateway → backend):** The gateway extracts `userId` from the verified JWT (`req.user.id`) and passes it as a regular CRUD parameter:
  - `userId` as a **query parameter** for GET and DELETE (e.g. `GET /v1/assets?userId=...`)
  - `userId` in the **request body** for POST and PATCH (e.g. `POST /v1/assets` body `{ fileId, kind, userId }`)
  - `userId` as a **form field** for multipart upload (e.g. `POST /v1/files` with `userId` in the multipart body alongside the file)
- **System calls (worker → backend):** The worker has `userId` in the BullMQ job payload (put there by the gateway when enqueueing). It passes it as a form field on upload, and the thumbnail register endpoint doesn't need it.
- **No custom auth headers between services.** No `x-user-id`, no `x-internal-token`, no `Authorization: Bearer <service-jwt>`. The `x-request-id` header is passed through for tracing only — it's not auth.

### How endpoints are structured

- **One controller per resource, no path-based split.** `AssetsController` handles all asset routes (user CRUD + by-file lookup + metadata update). `ThumbnailsController` handles all thumbnail routes (list, get, register, unregister). `UserFilesController` handles all file routes (upload, list, get, download, delete, stream, batch).
- **Route ordering matters.** Specific routes (`by-file/:fileId`, `by-user/:userId`, `:fileId/stream`) must be declared BEFORE parameterized routes (`:id`, `:fileId`) to avoid being matched as a path parameter.
- **`userId` in a query/body parameter is a data access concern, not a guard.** Service methods like `getOne(userId, id)` do `WHERE id = ? AND userId = ?` in the DB. This is enforced by the service layer, not by a guard or middleware.

### Trust boundary (non-negotiable for prod)

**In production, only the gateway is reachable from outside the trusted network.** Backend services (media-service, file-storage-service, worker-service) run on a private network and are not exposed to the internet. This is the only thing that makes "no auth between services" safe. The `docker-compose.yml` setup publishes backend ports for dev convenience — that's fine because dev runs on localhost, but in prod, backend ports must not be published.

If you ever misconfigure the prod network (accidentally publish a backend port, wrong ingress rule, etc.), there is zero auth backstop. The gateway is the only door. For a personal photo app, this is an acceptable bet — just make the deployment boundary explicit and don't forget it.

## Frontend conventions (web)

- **Icons: use Font Awesome only.** Import from `react-icons/fa6` (e.g. `FaCamera`, `FaLock`, `FaSpinner`). Do NOT use Material Symbols (`<span class="material-symbols-outlined">`) or any other icon set in the web app. The Material Symbols font link in `index.html` is legacy — ignore it.
- **Dark mode:** Default to dark (`<html class="dark">`). Uses Tailwind v4 with CSS-based config (`@import "tailwindcss"` + `@theme { ... }` in `apps/web/src/app.css`); there is no `tailwind.config.*` file.
- **Routing / state / client:** File-based routes via `vite-plugin-pages`, client-side routing via `react-router-dom@7`, state via `zustand`, HTTP client via `axios`. `vite.config.ts` proxies `/api` and `/health` to `http://localhost:3000` in dev.

## Code style

- No comments in code (per repo convention).
- 2-space indent, single quotes, no semicolons, 100-col print width, trailing commas (Prettier defaults in `.prettierrc`).
- Strict TS: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters` are on. `exactOptionalPropertyTypes` is `false`.
- ESLint (`@typescript-eslint/recommended-type-checked` + `stylistic-type-checked`) is type-aware — it reads each `tsconfig.json` via `project: true`. Don't add files that ESLint can't typecheck (e.g. random `*.cjs` outside the configured include) without updating `.eslintrc.cjs`.
- Workspace deps: `"@photox/shared-*": "workspace:*"`.

## Pact contract testing

- **Consumers:** One service has consumer pact tests:
  - **Gateway** (`apps/gateway/test/pact/consumer/`) — calls user-service, media-service, file-storage-service
    Uses `PactV3` from `@pact-foundation/pact`. ~18 interactions total: 7 auth, 6 assets, 5 files.
- **Providers:** Each backend service has pact verification tests at `test/pact/provider/gateway/` (for the gateway consumer). Uses `Verifier` from `@pact-foundation/pact`. Provider tests use mocked repositories (no testcontainers) — `Test.createTestingModule` with `overrideProvider(getRepositoryToken(Entity))`. Non-repository external services (e.g. `MinioService` in file-storage) are mocked via `overrideProvider(Token).useValue(...)`.
- **Pacts stored at repo root** `pacts/<consumer>-<provider>.json`. Not committed (in `.gitignore`). Regenerated fresh on every `pnpm verify`.
- **Commands per service:** `pnpm pact-consumer` runs `vitest run --config vitest.consumer.config.ts` (includes `test/pact/consumer/**`). `pnpm pact-provider` runs `vitest run --config vitest.provider.config.ts` (includes `test/pact/provider/**`). Both use `passWithNoTests: true`.
- **Root commands:** `pnpm pact-consumer` / `pnpm pact-provider` / `pnpm pact-coverage` run across all services via turbo. `pact-provider` depends on `pact-consumer` in `turbo.json` so consumers always run first.
- **`pnpm pact-coverage`** (`tsx scripts/pact-coverage.ts`) checks that every `pacts/*.json` is verified by a provider spec and that no provider spec references a missing pact; fails the build otherwise.
- **`pnpm verify`** wipes `pacts/`, then runs lint → `pact-consumer` → `pact-provider` → `pact-coverage` → test → typecheck → build.
- **File layout:**

  ```
  # Gateway (consumer) — apps/gateway/test/pact/consumer/
  setup.ts                                  # createPact(providerName) factory + PACT_DIR
  stub.ts                                   # StubProxy: captures + forwards to a PactV3 mockserver
  user-service/
    testing-module.ts                       # NestJS test module wired with AuthProxyController + stubbed ProxyService + APP_GUARD
    auth.pact.spec.ts
  media-service/
    testing-module.ts                       # ditto, AssetsProxyController
    assets.pact.spec.ts
  file-storage-service/
    testing-module.ts                       # ditto, FilesProxyController + HttpModule
    files.pact.spec.ts

  # Each backend service (provider) — apps/<service>/test/pact/provider/
  gateway/
    verifier.ts                             # setupMockedApp(): Test.createTestingModule with overrideProvider(...) for repos (and MinioService for file-storage); computes argon2 hash for auth flow
    mock-repos.ts                           # vi.fn()-backed repos for each entity
    <feature>.pact.spec.ts                  # user-service: auth | media-service: assets | file-storage-service: files

  # Per-service vitest configs
  vitest.consumer.config.ts                 # gateway has non-empty include set; others pass via passWithNoTests
  vitest.provider.config.ts                 # only backend services have matching spec files; gateway provider config exists for symmetry
  ```

## Verifying changes

After editing a service, `pnpm dev` (or the single-package filter) hot-reloads. Hit the health endpoint to confirm:

- `curl localhost:3000/health` — gateway (aggregates downstream)
- `curl localhost:3001/health` — user-service
- `curl localhost:3002/health` — media-service
- `curl localhost:3003/health` — file-storage-service
- `curl localhost:3004/health` — worker-service (Redis ping)
- `http://localhost:5173` — web app (timeline, login/register, upload, status grid)

Pre-commit order: `pnpm verify` (wipes `pacts/` and runs lint → `pact-consumer` → `pact-provider` → `pact-coverage` → test → typecheck → build in sequence). Alternatively, run individual steps: `pnpm pact-consumer && pnpm pact-provider && pnpm pact-coverage && pnpm typecheck && pnpm lint && pnpm test`.

## Implemented / out of scope

- **Implemented:** photo + video upload end-to-end (file-storage upload → gateway → web timeline page), media-service assets CRUD + trash/restore + thumbnails, gateway BFF layer (`api/` and `api/v1/*` proxy routes, including the public video stream route) with JWT guard + `ProxyService`, BullMQ async jobs (gateway publishes thumbnail + single-pass video jobs to Redis; worker-service consumes them with no DB of its own), web auth, login/register, timeline, and upload UI. Video playback uses a single mp4 streamed through the gateway (capability URL); ffmpeg transcode is an in-place byte replacement, not a transcode-to-HLS pipeline.
