# docker/postgres/

## Responsibility

Holds the single Postgres bootstrap script, `init.sql`:

```sql
CREATE DATABASE photox;
\c photox
CREATE EXTENSION IF NOT EXISTS vector;
```

Run by the official Postgres entrypoint on first initialization of the data directory to create the `photox` database and enable pgvector in it. Nothing else — no tables, roles, or seeds.

## Design

- The image is `pgvector/pgvector:0.8.3-pg16-bookworm` (compose), so the `vector` extension binary/control files are already present; `init.sql` only has to `CREATE EXTENSION`. Integration tests use plain `postgres:16-alpine` (testcontainers), which has no pgvector, so bootstrap steps that need the extension just warn there.
- Scripts in `/docker-entrypoint-initdb.d/` run **only when the `pgdata` volume is empty** (first boot). On an existing volume the file is ignored entirely, including the `CREATE DATABASE` line — which is fine because the DB already exists.
- No schema DDL lives here by design: TypeORM (`SharedDatabaseModule.forRoot()`, `synchronize: true`, `autoLoadEntities: true`) creates/updates all tables on core startup. `init.sql` is only for what TypeORM can't do: extension installation (and pgvector's HNSW index built at core bootstrap is warn-caught).
- Single database `photox`; only core connects with the `photox` user from compose env (the worker-service has no DB connection — it calls core HTTP).

## Flow

1. `docker compose up -d postgres` starts the pgvector image; the entrypoint detects an empty `pgdata` volume.
2. It executes `init.sql`: reconnects to `photox` (created beforehand by the entrypoint from `POSTGRES_DB`), creates the `vector` extension.
3. Postgres starts serving; compose's `pg_isready -U photox` healthcheck turns healthy.
4. Core connects and TypeORM `synchronize` materializes the schema (the worker never connects).

Rebuild-from-scratch recipe: `docker compose down -v` (drops `pgdata`) then up. Without `-v`, edits to `init.sql` have no effect.

## Integration

- Mounted by the `postgres` service in root `docker-compose.yml`: `./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql`.
- Consumed indirectly by `packages/data-access` (`SharedDatabaseModule`, entities) and by core, the only app that connects to Postgres.
- Faces feature depends on this: `faces_embedding_hnsw` and the 512-dim embedding column only work if the `vector` extension was created here (or manually).
