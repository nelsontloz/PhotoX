# packages/shared-config/

## Responsibility

One zod schema for every environment variable in the monorepo and one loader that validates
and normalizes it, plus the local-disk `LocalStorageService` shared by core and worker-service.
All apps and `data-access` call `loadEnv()`; nothing else reads
`process.env` for ports, DB/Redis coordinates, or storage paths.

## Design

`loadEnv()` is a parse-then-normalize pipeline:

1. `envSchema.safeParse(process.env)` — defaults for everything, `z.coerce.number()` for
   numeric fields. On failure it throws
   `Invalid environment variables: {…flattened fieldErrors}`.
2. `STORAGE_DIR` normalization: absolute paths pass through; relative paths are resolved
   against the workspace root, found by walking up from `process.cwd()` until a directory
   containing `pnpm-workspace.yaml` is found. This is deliberate (marked `ponytail:` in
   source): core and worker-service run with different cwds, so a bare `./data/storage`
   must not resolve inside each package's own directory.

Schema keys and defaults:

- `API_PORT` — 3000; `CORE_URL` — `http://localhost:3000` (worker → core; compose uses
  `http://core:3000`)
- `POSTGRES_HOST` — localhost; `POSTGRES_PORT` — 5432; `POSTGRES_USER` — photox;
  `POSTGRES_PASSWORD` — photox_dev
- `REDIS_HOST` — localhost; `REDIS_PORT` — 6379; `REDIS_PASSWORD` — optional, no default
  (compose and `.env.example` set `photox_dev`)
- `STORAGE_DIR` — `./data/storage`, anchored at the workspace root
- `AUTH_ACCESS_TTL` — `30m`; `AUTH_REFRESH_TTL` — `30d`; `AUTH_CLOCK_TOLERANCE_SEC` — 60

`src/storage.ts` exports `LocalStorageService` (`@Injectable()`): key layout under `STORAGE_DIR`
(`originals/…`, `derivatives/thumbnails/…`, `derivatives/transcodes/…`), `save` via tmp+rename with
an EXDEV copy fallback, `pathFor`/`createReadStream`/`stat`/`delete` (ENOENT-swallowing). This is
the only file that depends on `@nestjs/common`; the env schema itself needs zod only.

No import-time side effects; built with `tsc -b`.

## Flow

App/package startup (Nest `main.ts`, `SharedDatabaseModule.forRoot()`,
`LocalStorageService` method calls) → `loadEnv()` → validated plain object; callers
destructure the keys they need. Invalid config fails bootstrap fast with the complete field
error map instead of surfacing later as a connection error. Byte paths resolve through
`LocalStorageService` against the anchored `STORAGE_DIR`.

## Integration

Consumed by `apps/core` (`main.ts`, health, token service, files/faces/admin storage),
`apps/worker-service` (`loadEnv` + `LocalStorageService` + `CORE_URL`), and
`packages/data-access` (`database.module.ts`). `docker-compose.yml` and the root
`.env` are expected to use the same names; defaults are dev-localhost-friendly.
