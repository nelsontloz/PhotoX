# packages/

## Responsibility

Workspace-local shared libraries linked with `workspace:*` that sit between infrastructure
and the applications: config/env validation, auth contracts, wire types, and
persistence/storage primitives. All four are private (`"private": true`), TypeScript
composite, and build to `dist/` via `tsc -b` — apps import compiled output, never source.

## Design

Four packages, each with one concern, no duplication across apps:

- `packages/shared-config` — zod `loadEnv()` for every env var (ports, `CORE_URL`,
  Postgres/Redis, `STORAGE_DIR`, TTLs) + `LocalStorageService`; depends on zod and
  `@nestjs/common` (storage `@Injectable()`).
- `packages/shared-types` — wire interfaces plus the runtime `FACE_EMBEDDING_DIM` constant;
  no other runtime deps.
- `packages/shared-auth` — `JwtPayload` + `loadAuthEnv()` (`AUTH_TOKEN_SECRET` ≥32 chars);
  depends on shared-types for `Role`.
- `packages/data-access` — TypeORM entities + `SharedDatabaseModule`; depends on shared-config
  and is the only package with Nest/TypeORM/pgvector deps. Core-only (the worker no longer
  imports it).

Dependency direction is acyclic: `shared-config` and `shared-types` are leaves,
`shared-auth → shared-types`, `data-access → shared-config`. Composite project references
in each `tsconfig.json` make `tsc -b` respect that order; Docker builds run
`pnpm --filter @photox/<pkg> build` for each package before building any app.

## Flow

`pnpm install` (workspace link) → turbo `build` compiles packages in reference order → apps
consume `dist/index.d.ts` / `dist/index.js` at dev time and inside Docker images.
`pnpm verify` typechecks/lints/tests the packages, including `packages/data-access` (its own
`test` script and Vitest project); its entities are also exercised by core integration tests,
and `shared-config`'s storage service by both core and worker tests.

## Integration

- `apps/core` — all four packages (DB module, storage, auth env, config, wire DTO types).
- `apps/worker-service` — `shared-config` (env + storage), `shared-auth` (delegated JWT secret),
  `shared-types`; not `data-access`.
- `apps/web` — type-only imports of `shared-types` and `shared-auth` (`JwtPayload`).

No package imports from `apps/`; the dependency arrow only points downward.
