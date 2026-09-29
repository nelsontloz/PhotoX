# packages/

## Responsibility

Workspace-local shared libraries linked with `workspace:*` that sit between infrastructure
and the applications: config/env validation (incl. auth env and workspace-root `.env` loading)
and wire types. Both are private (`"private": true`), TypeScript composite, and build to
`dist/` via `tsc -b` — apps import compiled output, never source.

## Design

Two packages, each with one concern, no duplication across apps:

- `packages/shared-config` — zod `loadEnv()` for every env var (ports, `CORE_URL`,
  Postgres/Redis, `STORAGE_DIR`, TTLs), `loadAuthEnv()` (`AUTH_TOKEN_SECRET` ≥32 chars),
  `loadRootEnvFile()` (Node's native `.env` loader, replaces `@nestjs/config`) +
  `LocalStorageService`; depends on zod and `@nestjs/common` (storage `@Injectable()`).
- `packages/shared-types` — wire interfaces + `JwtPayload` plus the runtime
  `FACE_EMBEDDING_DIM` constant; no other runtime deps.

The TypeORM entities and DB module no longer live here: folded into
`apps/core/src/database/` (single consumer: core). Dependency direction is acyclic —
`shared-config` and `shared-types` are leaves and no package imports from `apps/`. Composite
project references in each `tsconfig.json` make `tsc -b` respect that order; Docker builds run
`pnpm --filter @photox/<pkg> build` for each package before building any app.

## Flow

`pnpm install` (workspace link) → turbo `build` compiles packages in reference order → apps
consume `dist/index.d.ts` / `dist/index.js` at dev time and inside Docker images.
`pnpm verify` typechecks/lints/tests the packages (`shared-config` has its own `test` script);
core integration tests exercise the in-tree entities/DB module.

## Integration

- `apps/core` — both packages (DB module, storage, env/auth env, wire DTO types).
- `apps/worker-service` — `shared-config` (env + storage + delegated JWT secret via
  `loadAuthEnv`) and `shared-types`; no Postgres.
- `apps/web` — type-only imports of `shared-types` (wire contracts + `JwtPayload`).

No package imports from `apps/`; the dependency arrow only points downward.
