# packages/data-access/

## Responsibility

The persistence and file-storage substrate shared by core and worker-service. It owns the
five TypeORM entities, the global Postgres connection factory (`SharedDatabaseModule`), and
the local-disk blob store (`LocalStorageService`). It knows nothing about HTTP, queues, or
business rules — apps register the entities they need via `TypeOrmModule.forFeature` and
call `SharedDatabaseModule.forRoot()` once at bootstrap.

## Design

Three layers, exported through `src/index.ts`:

- `src/entities/` — `FileRecord`, `Asset`, `AssetThumbnail`, `Face` (+ `FACE_EMBEDDING_DIM`),
  `Person`. Tables `files`, `assets`, `asset_thumbnails`, `faces`, `persons`. No migrations:
  `synchronize: true` means the entity decorators are the schema.
- `src/database.module.ts` — `@Global()` `SharedDatabaseModule.forRoot()` calls `loadEnv()`
  at definition time and returns a `TypeOrmModule.forRoot` dynamic module pointed at the
  hardcoded `photox` database. `autoLoadEntities: true`, `synchronize: true`,
  `connectTimeoutMS: 3000`, `retryAttempts: 3`, `retryDelay: 3000` (AGENTS.md: never set
  `retryAttempts: 0`). Exports `TypeOrmModule` so `@InjectRepository` resolves in consumers.
- `src/storage/local-storage.service.ts` — `@Injectable()` disk service rooted at
  `STORAGE_DIR`, with atomic writes and EXDEV fallback.

Dependencies: `@nestjs/common`, `@nestjs/typeorm`, `typeorm`, `pgvector`,
`@photox/shared-config`. Composite `tsc -b` build; no test script, so excluded from the
vitest workspace — consumers' integration tests exercise it against testcontainers.

## Flow

1. App boot → `SharedDatabaseModule.forRoot()` → `loadEnv()` → TypeORM `DataSource` retries
   local Postgres up to 3× (3s apart) before failing.
2. Controllers/processors obtain repositories via `@InjectRepository()` for the entities
   they declared in `forFeature`; this package never injects repositories itself.
3. File bytes flow app → `LocalStorageService.save(key, tmpPath)` → `STORAGE_DIR/<key>`;
   reads use `createReadStream`/`stat` for Range-capable streaming.

## Integration

- `apps/core/src/database/database.module.ts` wraps `forRoot()` and adds the pgvector
  bootstrap (HNSW `faces_embedding_hnsw`); core registers all five entities per feature.
- `apps/worker-service/src/queue/queue.module.ts` calls `forRoot()`, registers all five
  entities, and provides `LocalStorageService` to thumbnail/video/face/cleanup processors.
- `apps/core/src/files/storage/storage.module.ts` re-exports `LocalStorageService` to the
  core HTTP layer.
