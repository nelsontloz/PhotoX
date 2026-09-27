# packages/data-access/src/

## Responsibility

The package entry point and Nest wiring. `index.ts` is the public barrel through which
every consumer imports; `database.module.ts` builds the global Postgres connection from
`loadEnv()`; subfolders own entities (`entities/`) and disk access (`storage/`).

## Design

`src/index.ts` exports exactly `FileRecord`, `Asset`, `AssetThumbnail`, `Face`,
`FACE_EMBEDDING_DIM`, `Person`, `SharedDatabaseModule`, `LocalStorageService`. Entity
classes double as both TypeORM metadata and the type used in repositories.

`SharedDatabaseModule` is a `@Global()` Nest module whose static `forRoot()` returns a
`DynamicModule`:

- imports `TypeOrmModule.forRoot({ type: 'postgres', ... })` with host/port/user/password
  from `loadEnv()` (`POSTGRES_HOST` localhost, `POSTGRES_PORT` 5432, `POSTGRES_USER`
  photox, `POSTGRES_PASSWORD` photox_dev). The database name is hardcoded to `photox`.
- `autoLoadEntities: true` so `TypeOrmModule.forFeature([...])` calls in apps add entity
  metadata; `synchronize: true` keeps the schema in lockstep with the decorators.
- `connectTimeoutMS: 3000`, `retryAttempts: 3`, `retryDelay: 3000` — deliberately no
  `retryAttempts: 0` (see AGENTS.md).
- exports `TypeOrmModule`, which is what makes `@InjectRepository` resolvable in importing
  modules.

## Flow

`forRoot()` is invoked once per app at module-definition time, and `loadEnv()` validates
`process.env` right then, so a bad env fails fast during Nest bootstrap. Apps then declare
their own `TypeOrmModule.forFeature([...])` (core per domain module; worker-service all
five in `queue.module.ts`), and the shared `DataSource` is available process-wide via the
`@Global` export.

## Integration

- `apps/core/src/database/database.module.ts` composes `SharedDatabaseModule.forRoot()`'s
  imports with its `VECTOR_INIT` provider (pgvector extension + HNSW index bootstrap).
- `apps/worker-service/src/queue/queue.module.ts` uses `forRoot()` directly.
- Test helpers (`apps/core/test/integration/helpers.ts`,
  `apps/worker-service/test/integration/helpers.ts`) import entity classes and the storage
  service to seed/verify against throwaway Postgres + Redis containers.
