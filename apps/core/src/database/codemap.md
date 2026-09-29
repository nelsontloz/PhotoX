# apps/core/src/database/

## Responsibility

Core's database bootstrap: wraps the shared TypeORM module and adds the pgvector/HNSW index lifecycle needed for face-similarity search. One of the two `@Global()` infrastructure modules (with `queue/`).

## Design

`DatabaseModule` is `@Global()` and constructed via `forRoot()`:

- Inlines the TypeORM config (folded in from the deleted `packages/data-access`) — Postgres from `loadEnv()` (`POSTGRES_HOST/PORT/USER/PASSWORD`), database hard-coded `photox`, `autoLoadEntities: true`, `synchronize: true`, `connectTimeoutMS: 3000`, `retryAttempts: 3`, `retryDelay: 3000` (intentional for booting alongside compose; AGENTS.md forbids `retryAttempts: 0`).
- Adds provider `'VECTOR_INIT'` with an `onApplicationBootstrap` hook running raw SQL:
  1. `CREATE EXTENSION IF NOT EXISTS vector`
  2. `DROP INDEX IF EXISTS faces_embedding_hnsw`
  3. `CREATE INDEX faces_embedding_hnsw ON faces USING hnsw ((embedding::vector(512)) vector_cosine_ops)`
- The whole sequence is wrapped in one try/catch that only `Logger.warn`s: "pgvector extension or index creation failed — faces embedding search will be unavailable". Boot never fails on vector problems.
- `512` is the InsightFace `buffalo_l`/`w600k_r50` embedding dim (`FACE_EMBEDDING_DIM`), replacing the legacy human `faceres` 1024-dim output. The rebuild fails while legacy 1024-dim rows remain (warn-caught); `process-faces-cluster` re-embedding converts them.

Exports `TypeOrmModule` so every feature module can inject repositories. The five entities (`Asset`, `AssetThumbnail`, `FileRecord`, `Face`, `Person`) live in `entities/` (see `entities/codemap.md`).

## Flow

`AppModule` calls `loadRootEnvFile()` then imports `DatabaseModule.forRoot()`: TypeORM connects with retries → entities auto-loaded from all `forFeature` calls → after all modules initialize, `VECTOR_INIT` tries to (re)build the HNSW index → app listens.

## Integration

- Entities: `src/database/entities` (Asset, FileRecord, AssetThumbnail, Face, Person) plus feature-local `User`, `RefreshToken`, `Album`, `AlbumAsset`, `AssetShare`.
- Integration tests use plain `postgres:16-alpine` (no pgvector), so the bootstrap path is expected to warn rather than fail.
- The worker-service has no Postgres connection at all (it goes through core HTTP), so this is the only TypeORM bootstrap in the repo.
