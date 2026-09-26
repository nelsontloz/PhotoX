# apps/core/src/

## Responsibility

Composition root of the core API: `app.module.ts` wires all feature modules; `main.ts` applies the process-wide HTTP conventions (request id, validation, error shape, Swagger, port). This is the file pair AGENTS.md requires keeping in sync with the gateway's equivalent.

## Design

`AppModule` imports, in order:
1. `ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] })` — workspace-root `.env` first (core/worker run with different cwds).
2. `DatabaseModule.forRoot()` — TypeORM via `SharedDatabaseModule` + pgvector HNSW bootstrap.
3. `HealthModule`, `AuthModule` (registers the global `GatewayIdentityGuard` via `APP_GUARD`), `BullMqModule` (global publisher), `UsersModule`, `StorageModule`, `UserFilesModule`, `FilesAdminModule`, `TrashModule`, `AssetsModule`, `AlbumsModule`, `SharesModule`, `FacesModule`, `PersonsModule`, `AdminModule`.

`main.ts` bootstrap:
- `const env = loadEnv()` from `@photox/shared-config`; `NestFactory.create(AppModule, { rawBody: true })` keeps raw bodies available while multipart streams stay unparsed.
- `app.use(requestIdMiddleware)` first, then global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` and `HttpExceptionFilter`.
- Deliberately **no CORS** (comment in code: browsers hit the gateway; gateway→core is server-to-server).
- Swagger: `DocumentBuilder` ("Photox API", v1.0, tags `auth`/`users`/`admin`) served at `docs` with `jsonDocumentUrl: 'docs-json'` (both open routes).
- `app.listen(env.API_PORT)`, single `console.log` on boot, `void bootstrap()`.

Controllers own their full versioned paths (`@Controller('api/v1/...')`); there is no global prefix. Worker-service has its own bare `main.ts`.

## Flow

Request: gateway → `requestIdMiddleware` → global `GatewayIdentityGuard` (open-route table) → `ValidationPipe` → controller → service → TypeORM / `BullMqService`. Exceptions unwind through `HttpExceptionFilter`, then through the gateway proxy verbatim. Boot: ConfigModule → TypeORM connect (retry ×3) → all modules init → `VECTOR_INIT` HNSW rebuild → listen.

## Integration

- `AuthModule` supplies the global guard every module implicitly relies on; `DatabaseModule` and `BullMqModule` are `@Global()`.
- Feature folders are siblings (`assets/`, `albums/`, `shares/`, `faces/`, `persons/`, `files/*`, `admin/`, `trash/`); new modules must be added here to be part of the graph.
- Public paths: unversioned `health` + `docs*`, versioned `api/v1/*`, public share `api/share/*`.
