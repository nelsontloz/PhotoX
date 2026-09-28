# packages/data-access/

## Responsibility

The persistence substrate for core. It owns the five TypeORM entities and the global Postgres
connection factory (`SharedDatabaseModule`). It knows nothing about HTTP, queues, or business
rules — core registers the entities it needs via `TypeOrmModule.forFeature` and calls
`SharedDatabaseModule.forRoot()` once at bootstrap. The worker-service no longer touches this
package or Postgres at all (DB access is core HTTP), and `LocalStorageService` lives in
`packages/shared-config` now.

## Design

Two layers, exported through `src/index.ts`:

- `src/entities/` — `FileRecord`, `Asset`, `AssetThumbnail`, `Face`, `Person`. Tables `files`,
  `assets`, `asset_thumbnails`, `faces`, `persons`. No migrations:
  `synchronize: true` means the entity decorators are the schema.
- `src/database.module.ts` — `@Global()` `SharedDatabaseModule.forRoot()` calls `loadEnv()`
  at definition time and returns a `TypeOrmModule.forRoot` dynamic module pointed at the
  hardcoded `photox` database. `autoLoadEntities: true`, `synchronize: true`,
  `connectTimeoutMS: 3000`, `retryAttempts: 3`, `retryDelay: 3000` (AGENTS.md: never set
  `retryAttempts: 0`). Exports `TypeOrmModule` so `@InjectRepository` resolves in consumers.

Dependencies: `@nestjs/common`, `@nestjs/typeorm`, `typeorm`, `pgvector`,
`@photox/shared-config`. Composite `tsc -b` build; has its own `test` script and Vitest
project (in the root workspace) alongside core's integration tests, which exercise it
against testcontainers.

## Flow

1. App boot (core) → `SharedDatabaseModule.forRoot()` → `loadEnv()` → TypeORM `DataSource` retries
   local Postgres up to 3× (3s apart) before failing.
2. Controllers/services obtain repositories via `@InjectRepository()` for the entities
   they declared in `forFeature`; this package never injects repositories itself.

## Integration

- `apps/core/src/database/database.module.ts` wraps `forRoot()` and adds the pgvector
  bootstrap (HNSW `faces_embedding_hnsw`); core registers all five entities per feature.
- The worker-service only reaches these tables through core HTTP; it has no `@photox/data-access`
  dependency (only core does).
- `apps/core/src/files/storage/storage.module.ts` re-exports `LocalStorageService` (from
  `@photox/shared-config`) to the core HTTP layer.
