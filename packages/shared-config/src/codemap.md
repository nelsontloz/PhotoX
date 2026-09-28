# packages/shared-config/src/

## Responsibility

The implementation behind `@photox/shared-config`: `env.ts` defines the schema, loader, and
workspace-root anchoring; `storage.ts` holds the `LocalStorageService`; `index.ts` is the public
barrel. Nothing here depends on TypeORM or any app (`storage.ts` uses `@nestjs/common` only for
its `@Injectable()` decorator).

## Design

`env.ts`

- `envSchema` (zod object, 15 keys): `NODE_ENV` enum default `development`; `API_PORT` 3000;
  `CORE_URL` `http://localhost:3000` (worker → core; compose `http://core:3000`);
  `WORKER_SERVICE_PORT` 3004;
  `POSTGRES_HOST` localhost; `POSTGRES_PORT` 5432; `POSTGRES_USER` photox;
  `POSTGRES_PASSWORD` photox_dev; `REDIS_HOST` localhost; `REDIS_PORT` 6379;
  `REDIS_PASSWORD` optional (no default; compose sets `photox_dev`); `STORAGE_DIR`
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

`storage.ts` exports `LocalStorageService` (`@Injectable()`), rooted at `loadEnv().STORAGE_DIR`:
`buildKey(kind, userId, fileId, ext)` maps to `originals/…`, `derivatives/thumbnails/…`,
`derivatives/transcodes/…`; `save(key, tmpPath)` is atomic (rename, EXDEV copy+unlink fallback);
`pathFor`/`stat`/`createReadStream(key, range?)`/`exists`/`delete` (ENOENT-swallowing) round out
the disk API; `ensureDir()` creates the root.

`index.ts` re-exports `loadEnv`, `type Env`, and `LocalStorageService`; no default export.

## Flow

Every call re-reads `process.env` (no caching) and re-walks for the workspace root, so tests
can mutate env between cases and still get correct paths. Besides `process.env`,
`process.cwd()` is the only ambient input.

## Integration

Imported by `packages/data-access` (`database.module.ts`) and both backend apps (`core`,
`worker-service`), plus core integration-test helpers. The `Env` type is used wherever a
validated config object is passed around (e.g. the core token service); `LocalStorageService`
is provided per Nest context by `StorageModule` (core) and `QueueModule` (worker).
