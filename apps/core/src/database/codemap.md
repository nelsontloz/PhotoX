# apps/core/src/database/

## Responsibility

Core's database bootstrap: wraps the shared TypeORM module and adds the pgvector/HNSW index lifecycle needed for face-similarity search. One of the two `@Global()` infrastructure modules (with `queue/`).

## Design

`DatabaseModule` is `@Global()` and constructed via `forRoot()`:
- Reuses `SharedDatabaseModule.forRoot()` from `@photox/data-access` — Postgres from `loadEnv()` (`POSTGRES_HOST/PORT/USER/PASSWORD`), database hard-coded `photox`, `autoLoadEntities: true`, `synchronize: true`, `connectTimeoutMS: 3000`, `retryAttempts: 3`, `retryDelay: 3000` (intentional for booting alongside compose; AGENTS.md forbids `retryAttempts: 0`).
- Adds provider `'VECTOR_INIT'` with an `onApplicationBootstrap` hook running raw SQL:
  1. `CREATE EXTENSION IF NOT EXISTS vector`
  2. `DROP INDEX IF EXISTS faces_embedding_hnsw`
  3. `CREATE INDEX faces_embedding_hnsw ON faces USING hnsw ((embedding::vector(512)) vector_cosine_ops)`
- The whole sequence is wrapped in one try/catch that only `Logger.warn`s: "pgvector extension or index creation failed — faces embedding search will be unavailable". Boot never fails on vector problems.
- `512` is the InsightFace `buffalo_l`/`w600k_r50` embedding dim (`FACE_EMBEDDING_DIM`), replacing the legacy human `faceres` 1024-dim output. The rebuild fails while legacy 1024-dim rows remain (warn-caught); `process-faces-cluster` re-embedding converts them.

Exports `TypeOrmModule` and re-exports the shared module's imports so every feature module can inject repositories.

## Flow

`AppModule` imports `DatabaseModule.forRoot()` right after `ConfigModule`: TypeORM connects with retries → entities auto-loaded from all `forFeature` calls + `@photox/data-access` → after all modules initialize, `VECTOR_INIT` tries to (re)build the HNSW index → app listens.

## Integration

- Entities: `packages/data-access` (Asset, FileRecord, AssetThumbnail, Face, Person) plus feature-local `User`, `RefreshToken`, `Album`, `AlbumAsset`, `AssetShare`.
- Integration tests use plain `postgres:16-alpine` (no pgvector), so the bootstrap path is expected to warn rather than fail.
- worker-service uses `SharedDatabaseModule` directly, without the vector bootstrap.
