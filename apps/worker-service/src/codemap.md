# apps/worker-service/src/

## Responsibility

Bootstrap layer of worker-service: define the Nest module graph (`app.module.ts`) and start the HTTP
listener (`main.ts`). No business logic lives here — everything delegates to `queue/` (BullMQ
consumers) and `health/` (liveness). Intentionally bare per the repo's worker convention: no global
pipes, filters, middleware, or Swagger because nothing user-facing is served.

## Design

- `AppModule` = `ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] })`
  - `QueueModule` + `HealthModule`. Config is global so `ConfigService` is injectable in
    `BullMqService` (for `REDIS_HOST`/`REDIS_PORT`) without re-importing.
- `envFilePath` order matters: `pnpm --filter @photox/worker-service dev` uses cwd
  `apps/worker-service`, so `../../.env` is the repo-root file and `.env` a local override.
- `main.ts` is a 12-line bootstrap: `NestFactory.create(AppModule)`, port
  `Number(process.env.WORKER_SERVICE_PORT) || 3004`, `app.listen(port)`. No composed port, mirroring
  core's internal-only posture.
- Side effects on init: Nest runs `QueueModule.onModuleInit()` during bootstrap (starts all 7 BullMQ
  workers); `FaceDetectorService.onModuleInit()` lazy-imports tfjs-node/human, and
  `FaceEmbedderService` lazy-loads onnxruntime-node on first embed. "App started" therefore means
  consumers are listening; face models load on first face job.
- Deliberately absent vs `apps/core/src/main.ts`: `ValidationPipe`, `HttpExceptionFilter`,
  `requestIdMiddleware`, Swagger `/docs` + `/docs-json`. Keep the divergence intentional.

## Flow

1. Process start → ConfigModule loads `.env` (repo root, then local) → providers instantiate.
2. `BullMqService.onModuleInit()` opens the shared ioredis connection and waits for `ready`.
3. `QueueModule.onModuleInit()` calls `.start()` on each of the 7 processors → BullMQ workers register.
4. `main.ts` listens on 3004 for health probes, then blocks forever consuming jobs.
5. Shutdown → `BullMqService.onModuleDestroy()` closes workers, cached queues, then the connection.

## Integration

- Imports only `./queue/queue.module` and `./health/health.module`; shared logic comes from
  `@photox/data-access` (entities, `SharedDatabaseModule`, `LocalStorageService`) and
  `@photox/shared-config` (`loadEnv()` for `STORAGE_DIR`).
- Counterpart of `apps/core/src/app.module.ts` (full HTTP conventions) and the consumer side of
  `apps/core/src/queue/` (publisher).
- Job payload shapes, retry/dedup semantics, ffmpeg invocation, and the face pipeline are documented
  in `queue/codemap.md`; health probing in `health/codemap.md`.
