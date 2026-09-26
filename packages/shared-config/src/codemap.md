# packages/shared-config/src/

## Responsibility

The implementation behind `@photox/shared-config`: `env.ts` defines the schema, loader, and
workspace-root anchoring; `index.ts` is the public barrel. Nothing here depends on Nest,
TypeORM, or any app.

## Design

`env.ts`
- `envSchema` (zod object, 15 keys): `NODE_ENV` enum default `development`; `API_PORT` 3000;
  `GATEWAY_PORT` 3001; `CORE_BASE_URL` `http://localhost:3000`; `WORKER_SERVICE_PORT` 3004;
  `POSTGRES_HOST` localhost; `POSTGRES_PORT` 5432; `POSTGRES_USER` photox;
  `POSTGRES_PASSWORD` photox_dev; `REDIS_HOST` localhost; `REDIS_PORT` 6379; `STORAGE_DIR`
  `./data/storage`; `AUTH_ACCESS_TTL` `30m`; `AUTH_REFRESH_TTL` `30d`;
  `AUTH_CLOCK_TOLERANCE_SEC` 60. Numeric keys use `z.coerce.number()`, so env strings work.
- `export type Env = z.infer<typeof envSchema>` — the schema is the type.
- `findWorkspaceRoot(start)` walks parent directories until it finds `pnpm-workspace.yaml`,
  returning `start` if it reaches the filesystem root.
- `loadEnv()`: `safeParse(process.env)` → throw `Invalid environment variables:
  {flattened}` on failure; otherwise spread the parsed data and override `STORAGE_DIR`:
  absolute stays as-is, relative becomes
  `resolve(findWorkspaceRoot(process.cwd()), storageDir)`. The anchoring rationale is
  marked `ponytail:` in source — keep it.

`index.ts` re-exports only `loadEnv` and `type Env`; no default export.

## Flow

Every call re-reads `process.env` (no caching) and re-walks for the workspace root, so tests
can mutate env between cases and still get correct paths. Besides `process.env`,
`process.cwd()` is the only ambient input.

## Integration

Imported by `packages/data-access` (`database.module.ts`, `local-storage.service.ts`) and
all three backend apps (`core`, `gateway`, `worker-service`), plus integration-test helpers.
The `Env` type is used wherever a validated config object is passed around (e.g. the core
token service).
