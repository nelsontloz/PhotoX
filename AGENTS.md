# Photox — Agent Notes

Personal photo/video hosting. NestJS microservices monorepo with a Vite React web app.

## Stack

- **Monorepo:** Turborepo + pnpm workspaces (`apps/*`, `packages/*`)
- **Backend:** NestJS 10, TypeORM, PostgreSQL, Redis, MinIO
- **Frontend:** Vite + React + TypeScript
- **Single PG instance, 3 databases:** `users_db`, `library_db`, `files_db` (see `docker/postgres/init.sql`)

## Repository layout

```
apps/
  gateway/              NestJS, port 3000
  user-service/         NestJS, port 3001
  library-service/      NestJS, port 3002
  file-storage-service/ NestJS, port 3003
  web/                  Vite + React, port 5173
packages/
  shared-types/         DTOs (sparse for now)
  shared-events/        Event constants + payload types
  shared-auth/          Auth types (JwtPayload, TokenPair)
  shared-redis/         RedisService + RedisModule.forRoot()
  shared-config/        Zod env loader (loadEnv)
docker/
  postgres/init.sql     Creates the 3 databases
docker-compose.yml      8 services: postgres, redis, minio, 4 nestjs, web
```

## Essential commands

```bash
# 1. Start infrastructure FIRST (services need postgres/redis/minio)
docker compose up -d postgres redis minio

# 2. Then start apps
pnpm dev              # runs all 10 packages in watch mode via turbo
pnpm build            # builds all packages (turbo pipeline)
pnpm typecheck        # tsc --noEmit across packages
pnpm lint
```

Single package:
```bash
pnpm --filter @photox/user-service dev
pnpm --filter @photox/gateway build
```

After pulling: `pnpm install` once, then docker compose, then `pnpm dev`.

## tsconfig rules that bite

- Root `tsconfig.base.json` has `experimentalDecorators` + `emitDecoratorMetadata` enabled (NestJS requires these).
- `composite` + `incremental` are set ONLY in the 5 shared package tsconfigs (which use `tsc -b`). They are NOT in the base — NestJS apps use `nest build` (composite breaks it). If a new shared package is added, it must set `composite: true` in its tsconfig or it will build but produce no dist output.
- All NestJS apps have `"@types/node": "^22.0.0"` and `"typescript": "^5.7.0"` in dependencies. Do NOT use `workspace:*` for typescript — it doesn't resolve. Use the version number.

## NestJS module gotchas (verified the hard way)

**`RedisModule` is `@Global()` in `shared-redis` but that means nothing until it's imported.** Each NestJS `AppModule` must import `RedisModule.forRoot({ host, port })` or `RedisService` won't be resolvable.

**`ioredis` must be created lazily.** `new Redis({ lazyConnect: true })` alone does NOT prevent ECONNREFUSED crashes when Redis is down — ioredis still emits unhandled `error` events. The pattern used here: `RedisService` creates the ioredis client only inside `getClient()` (called from `ping()`/`publish()`/`subscribe()`), with `this.client.on('error', () => {})` attached at creation time. Module factory uses `useValue`, not `useFactory` with `connect()`. Don't refactor to eager connection.

**`HealthService` uses `DataSource.query('SELECT 1')`, not `@InjectRepository()`.** A repository injection requires `TypeOrmModule.forFeature()` in the module — too much coupling for a health check. `DataSource` is globally available because the DB `TypeOrmModule.forRoot()` is imported in `AppModule`.

**`file-storage-service` HealthModule must import `StorageModule`** so `MinioService` is in scope.

**Gateway has no DB.** Its `HealthService` only checks downstream services via `HttpService` — no `DataSource` or `RedisService` injection.

**TypeORM config:** Each backend service has `retryAttempts: 3, retryDelay: 3000, connectTimeoutMS: 3000` in `DatabaseModule.forRoot()`. Do NOT set `retryAttempts: 0` — it makes the process crash immediately on connection failure instead of waiting briefly.

**`useValue` for RedisModule:** the `useFactory: async () => { await redisService.connect() }` pattern WILL crash the process on ECONNREFUSED because the connect attempt throws inside the factory. Use `useValue: redisService` instead.

## API conventions (apply to all NestJS services)

- **Path versioning lives on the service.** Each backend service exposes its public routes under `/v1/...` declared on the controller, e.g. `@Controller('v1/auth')` in user-service. Do NOT use a global `app.setGlobalPrefix` — keep version routes explicit per controller.
- **Health is unversioned.** Each service exposes `GET /health` (no `v1` prefix) because the web app calls it directly on the service port for the status grid.
- **Global pipes & filters are mandatory.** Every `main.ts` must include: `app.useGlobalPipes(new ValidationPipe({ whitelist, forbidNonWhitelisted, transform }))` and `app.useGlobalFilters(new HttpExceptionFilter())`. The shared `HttpExceptionFilter` lives at `apps/<service>/src/common/filters/http-exception.filter.ts`.
- **Validation uses class-validator + class-transformer.** DTOs live next to the controller in `apps/<service>/src/<feature>/dto/*.dto.ts`. `class-validator` and `class-transformer` must be added to the service's `package.json` even though they are optional peers of `@nestjs/common` — do not rely on hoisting.
- **Cross-service request/response shapes live in `shared-types`.** Service-local DTOs may carry class-validator decorators, but the *interface* that crosses the wire is in `shared-types`. DTOs implement the interface.
- **Cross-service event payloads live in `shared-events`.** Publisher and consumer both import the typed event from there.
- **CORS lives at the gateway, not on individual services.** Backend services do not call `enableCors()`. Only the gateway does, and only for the web origin(s).

## NestJS module gotchas (continued)

**Password hashing: argon2 only.** Use `argon2` (not bcrypt, not `bcryptjs`). Native binding needs `python3 make g++` in the Docker build stages (`deps` + `build`). If a service does not need passwords (gateway, file-storage), don't add the dep.

**Token model: opaque, persisted, rotated.** Tokens are 32 random bytes (`crypto.randomBytes(32).toString('base64url')`). Both access and refresh tokens are hashed (sha256) and stored in the `refresh_tokens` table with a `purpose` discriminator and `expiresAt`. `/refresh` rotates (revokes the old row, issues two new rows). `/logout` revokes the refresh row. JWTs are not used in this project — do not add `jsonwebtoken` or `@nestjs/jwt` to any service.

**Token TTLs come from env.** `AUTH_ACCESS_TTL` (default `15m`) and `AUTH_REFRESH_TTL` (default `30d`) live in `shared-config/src/env.ts`.

## Code style

- No comments in code (per repo convention).
- 2-space indent, single quotes, no semicolons (Prettier defaults in `.prettierrc`).
- Strict TS: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters` are on.
- Workspace deps: `"@photox/shared-*": "workspace:*"`.

## Verifying changes

After editing a service, `pnpm dev` (or the single-package filter) hot-reloads. Hit the health endpoint to confirm:
- `curl localhost:3000/health` — gateway (aggregates downstream)
- `curl localhost:3001/health` — user-service
- `curl localhost:3002/health` — library-service
- `curl localhost:3003/health` — file-storage-service
- `http://localhost:5173` — web app (service status grid)

## Out of scope (for now)

- No business logic yet — only `/health` and `/api/services` (gateway) endpoints were the previous baseline. user-service now also exposes `/v1/auth/{register,login,refresh,logout}`. Photo upload, albums, profile management remain the next phase.
- No tests configured.
- No CI.
