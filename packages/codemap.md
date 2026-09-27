# packages/

## Responsibility

Workspace-local shared libraries linked with `workspace:*` that sit between infrastructure
and the applications: config/env validation, auth contracts, wire types, and
persistence/storage primitives. All four are private (`"private": true`), TypeScript
composite, and build to `dist/` via `tsc -b` — apps import compiled output, never source.

## Design

Four packages, each with one concern, no duplication across apps:

- `packages/shared-config` — zod `loadEnv()` for every env var (ports, Postgres/Redis,
  `STORAGE_DIR`, TTLs); depends on zod only.
- `packages/shared-types` — pure type-only wire interfaces used by core and web;
  zero runtime deps.
- `packages/shared-auth` — `JwtPayload` + `loadAuthEnv()` (`AUTH_TOKEN_SECRET` ≥32 chars);
  depends on shared-types for `Role`.
- `packages/data-access` — TypeORM entities, `SharedDatabaseModule`, `LocalStorageService`;
  depends on shared-config and is the only package with Nest/TypeORM/pgvector deps.

Dependency direction is acyclic: `shared-config` and `shared-types` are leaves,
`shared-auth → shared-types`, `data-access → shared-config`. Composite project references
in each `tsconfig.json` make `tsc -b` respect that order; Docker builds run
`pnpm --filter @photox/<pkg> build` for each package before building any app.

## Flow

`pnpm install` (workspace link) → turbo `build` compiles packages in reference order → apps
consume `dist/index.d.ts` / `dist/index.js` at dev time and inside Docker images.
`pnpm verify` typechecks/lints/tests the packages, including `packages/data-access` (its own
`test` script and Vitest project); its entities and storage service are also exercised by core
and worker-service integration tests.

## Integration

- `apps/core` — all four packages (DB module + storage, auth env, config, wire DTO types).
- `apps/worker-service` — `data-access` (entities, storage) + `shared-config`.
- `apps/web` — type-only imports of `shared-types` and `shared-auth` (`JwtPayload`).

No package imports from `apps/`; the dependency arrow only points downward.
