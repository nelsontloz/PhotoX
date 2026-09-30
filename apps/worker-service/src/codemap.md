# apps/worker-service/src/

## Responsibility

Bootstrap layer of worker-service: define the Nest module graph (`app.module.ts`) and start the HTTP
listener (`main.ts`). No business logic lives here — everything delegates to `queue/` (BullMQ
consumers), `core/` (`CoreClient`: all DB reads/writes as core HTTP calls), and `health/`
(liveness). Intentionally bare per the repo's worker convention: no global pipes, filters,
middleware, or Swagger because nothing user-facing is served.

## Design

- `AppModule` = `loadRootEnvFile()` (Node's native `.env` loader, workspace-root file; process env
  wins) then `QueueModule` + `HealthModule`. No `@nestjs/config`; `BullMqService` reads `REDIS_*`
  from `loadEnv()` at `onModuleInit`.
- `main.ts` is a 12-line bootstrap: `NestFactory.create(AppModule)`, port
  `Number(process.env.WORKER_SERVICE_PORT) || 3004`, `app.listen(port)`. No composed port, mirroring
  core's internal-only posture.
- Side effects on init: Nest runs `QueueModule.onModuleInit()` during bootstrap (starts all 7 BullMQ
  workers); `FaceDetectorService.onModuleInit()` lazy-imports tfjs-node/human, and
  `FaceEmbedderService` lazy-loads onnxruntime-node on first embed. "App started" therefore means
  consumers are listening; face models load on first face job.
- `QueueModule` registers `JwtModule.registerAsync` with `loadAuthEnv().AUTH_TOKEN_SECRET` — the
  worker mints delegated per-job tokens in `CoreClient` (never verifies incoming tokens).
- Deliberately absent vs `apps/core/src/main.ts`: `ValidationPipe`, `HttpExceptionFilter`,
  Swagger `/docs` + `/docs-json`. Keep the divergence intentional.

## Flow

1. Process start → `loadRootEnvFile()` loads `.env` (repo root, then local) → providers instantiate.
2. `BullMqService.onModuleInit()` opens the shared ioredis connection and waits for `ready`.
3. `QueueModule.onModuleInit()` calls `.start()` on each of the 7 processors → BullMQ workers register.
4. `main.ts` listens on 3004 for health probes, then blocks forever consuming jobs.
5. Shutdown → `BullMqService.onModuleDestroy()` closes workers, cached queues, then the connection.

## Integration

- Imports only `./queue/queue.module` and `./health/health.module`; DB access is indirect through
  `./core/core-client.service.ts` (`CoreClient`), which signs per-job delegated JWTs with
  `loadAuthEnv` from `@photox/shared-config` and calls core at `CORE_URL`. `LocalStorageService` and `loadEnv()` come from
  `@photox/shared-config`; wire types from `@photox/shared-types`. No Postgres/TypeORM import.
- Counterpart of `apps/core/src/app.module.ts` (full HTTP conventions) and the consumer side of
  `apps/core/src/queue/` (publisher).
- Job payload shapes, retry/dedup semantics, ffmpeg invocation, and the face pipeline are documented
  in `queue/codemap.md`; health probing in `health/codemap.md`.
