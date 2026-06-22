# Photox — Agent Notes

Personal photo/video hosting. NestJS microservices monorepo with a Vite React web app.

## Stack

- **Monorepo:** Turborepo + pnpm workspaces (`apps/*`, `packages/*`)
- **Backend:** NestJS 10, TypeORM, PostgreSQL, MinIO
- **Frontend:** Vite + React + TypeScript
- **Single PG instance, 3 databases:** `users_db`, `library_db`, `files_db` (see `docker/postgres/init.sql`)
- **Node:** 20 (see `.nvmrc`), **pnpm:** 9.15.0 (see `packageManager` in root `package.json`)

## Repository layout

```
apps/
  gateway/              NestJS, port 3000
  user-service/         NestJS, port 3001
  media-service/        NestJS, port 3002
  file-storage-service/ NestJS, port 3003
  web/                  Vite + React, port 5173
packages/
  shared-types/         DTOs (sparse for now)
  shared-events/        Event constants + payload types
  shared-auth/          Auth types (JwtPayload, TokenPair)
  shared-config/        Zod env loader (loadEnv)
docker/
  base-builder/Dockerfile  Base image (node 20 + python3 make g++ + pnpm) for CI
  postgres/init.sql        Creates the 3 databases
Jenkinsfile                CI pipeline (k8s pod; testcontainers)
scripts/                   Root tooling (pact-coverage.ts)
docker-compose.yml         7 services: postgres, minio, 4 nestjs, web
```

## Essential commands

```bash
# 1. Start infrastructure FIRST (services need postgres/minio)
docker compose up -d postgres minio

# 2. Then start apps
pnpm dev              # runs the 5 apps in watch mode via turbo (shared packages have no `dev`)
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

- **Runner:** Vitest 3 everywhere (backend + web). Configs: `vitest.workspace.ts` at root lists 11 workspaces (5 apps + 5 shared packages + `scripts`); each app/package has its own `vitest.config.ts` with `globals: true` and `passWithNoTests: true`. The web app's vitest config lives inside `vite.config.ts` (single `defineConfig` with a `test` block) because Vite is its only build tool there.
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

**TypeORM config:** Each backend service has `retryAttempts: 3, retryDelay: 3000, connectTimeoutMS: 3000` in `DatabaseModule.forRoot()`. Do NOT set `retryAttempts: 0` — it makes the process crash immediately on connection failure instead of waiting briefly.

## API conventions (apply to all NestJS services)

- **Path versioning lives on the service.** Each backend service exposes its public routes under `/v1/...` declared on the controller, e.g. `@Controller('v1/auth')` in user-service. Do NOT use a global `app.setGlobalPrefix` — keep version routes explicit per controller.
- **Gateway BFF routes live under `api/`.** The gateway exposes `api/services`, `api/v1/auth`, `api/v1/assets`, and `api/v1/files` via proxy controllers that forward to backend services. `ProxyService` strips hop-by-hop headers, maps downstream 4xx to `HttpException`, 5xx / connection failures to `BadGatewayException` (502), and forwards `x-user-id` upstream.
- **Health is unversioned.** Each service exposes `GET /health` (no `v1` prefix) because the web app calls it directly on the service port for the status grid.
- **Global pipes & filters are mandatory.** Every `main.ts` must include: `app.useGlobalPipes(new ValidationPipe({ whitelist, forbidNonWhitelisted, transform }))` and `app.useGlobalFilters(new HttpExceptionFilter())`. The shared `HttpExceptionFilter` lives at `apps/<service>/src/common/filters/http-exception.filter.ts`.
- **Validation uses class-validator + class-transformer.** DTOs live next to the controller in `apps/<service>/src/<feature>/dto/*.dto.ts`. `class-validator` and `class-transformer` must be added to the service's `package.json` even though they are optional peers of `@nestjs/common` — do not rely on hoisting.
- **Cross-service request/response shapes live in `shared-types`.** Service-local DTOs may carry class-validator decorators, but the _interface_ that crosses the wire is in `shared-types`. DTOs implement the corresponding `shared-types` interface where one exists (e.g. `RegisterDto`, `LoginDto`, `RefreshDto`, `LogoutDto`, `AuthResponseDto`, `FileRecordDto`, `BatchFilesResponseDto`).
- **Cross-service event payloads live in `shared-events`.** Defined but currently unused — there are no publishers or consumers yet.
- **CORS lives at the gateway, not on individual services.** Backend services do not call `enableCors()`. Only the gateway does, and only for the web origin(s).
- **Each backend service exposes Swagger UI at `/docs` and the raw OpenAPI JSON at `/docs-json`** (both at the service root, unversioned, always public within `photox-net`). `main.ts` configures `SwaggerModule` with `DocumentBuilder`. Every backend service has a `nest-cli.json` that enables `@nestjs/swagger/plugin` for auto-inference from TS types. Service-local DTOs are decorated with `@ApiProperty` and `implements` the corresponding `shared-types` interface. `shared-types` itself never imports `@nestjs/swagger` — the decorators live in the service.

## Auth

**Password hashing: argon2 only.** Use `argon2` (not bcrypt, not `bcryptjs`). Native binding needs `python3 make g++` in the Docker build stages (`deps` + `build`). If a service does not need passwords (gateway, file-storage), don't add the dep.

**Token model: split.** **Access tokens** are HS256 JWTs (`@nestjs/jwt`), self-describing, locally verifiable, default 30m TTL (`AUTH_ACCESS_TTL`). **Refresh tokens** are opaque, persisted, rotated: 32 random bytes hashed (sha256) and stored in the `refresh_tokens` table with `purpose = 'refresh'` and `expiresAt`. `/refresh` rotates (revokes the old row, issues a new pair). `/logout` revokes the refresh row. A JWT access token cannot be revoked before its `exp` — the refresh token is the only revocation surface.

**Token TTLs and secrets come from env.** `AUTH_ACCESS_TTL` (default `30m`) and `AUTH_REFRESH_TTL` (default `30d`) live in `shared-config/src/env.ts`. `AUTH_TOKEN_SECRET` (required, ≥32 characters) and `AUTH_CLOCK_TOLERANCE_SEC` (default `60`) live in `packages/shared-auth/src/env.ts` via `loadAuthEnv()`, shared by user-service and the gateway.

**Jwt payload shape.** `JwtPayload` in `shared-auth` is `{ sub, email, iat, exp, jti? }`. The gateway's `JwtStrategy` maps `payload.sub` to a request user of `{ id, email }` and forwards `x-user-id` upstream.

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

- **Consumer:** Gateway (`apps/gateway`) is the only consumer. Pact tests at `test/pact/consumer/`. Uses `PactV3` from `@pact-foundation/pact`. 18 interactions total across user-service, media-service, file-storage-service: 7 auth (4 happy + 409/401/401), 6 assets (all happy), 5 files (4 happy + 404).
- **Providers:** Each backend service has pact verification tests at `test/pact/provider/gateway/`. Uses `Verifier` from `@pact-foundation/pact`. Provider tests use mocked repositories (no testcontainers) — `Test.createTestingModule` with `overrideProvider(getRepositoryToken(Entity))`. Non-repository external services (e.g. `MinioService` in file-storage) are mocked via `overrideProvider(Token).useValue(...)`.
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

  # Each backend service (provider) — apps/<service>/test/pact/provider/gateway/
  verifier.ts                               # setupMockedApp(): Test.createTestingModule with overrideProvider(...) for repos (and MinioService for file-storage); computes argon2 hash for auth flow
  mock-repos.ts                             # vi.fn()-backed repos for each entity
  <feature>.pact.spec.ts                    # user-service: auth | media-service: assets | file-storage-service: files

  # Per-service vitest configs
  vitest.consumer.config.ts                 # only the gateway has a non-empty include set; backend consumer configs exist for symmetry and pass via passWithNoTests
  vitest.provider.config.ts                 # only backend services have matching spec files; gateway provider config exists for symmetry
  ```

## Verifying changes

After editing a service, `pnpm dev` (or the single-package filter) hot-reloads. Hit the health endpoint to confirm:

- `curl localhost:3000/health` — gateway (aggregates downstream)
- `curl localhost:3001/health` — user-service
- `curl localhost:3002/health` — media-service
- `curl localhost:3003/health` — file-storage-service
- `http://localhost:5173` — web app (timeline, login/register, upload, status grid)

Pre-commit order: `pnpm verify` (wipes `pacts/` and runs lint → `pact-consumer` → `pact-provider` → `pact-coverage` → test → typecheck → build in sequence). Alternatively, run individual steps: `pnpm pact-consumer && pnpm pact-provider && pnpm pact-coverage && pnpm typecheck && pnpm lint && pnpm test`.

## Implemented / out of scope

- **Implemented:** photo upload end-to-end (file-storage upload → gateway → web timeline page), media-service assets CRUD + trash/restore + thumbnails + internal cross-service endpoints, gateway BFF layer (`api/` and `api/v1/*` proxy routes) with JWT guard + `ProxyService`, web auth, login/register, timeline, and upload UI.
