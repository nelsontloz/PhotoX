# apps/core/

## Responsibility

`@photox/core` is the NestJS API (:3000, no published Docker port) owning every HTTP domain: auth/users, assets, albums, files (user/admin), shares, faces/persons, trash, admin, health. It is the only process that mutates domain tables through TypeORM and the main BullMQ producer into Redis. It is the sole API app; a reverse proxy sits in front of it when external exposure is needed.

## Design

- NestJS 11 + Express, TypeORM 0.3 (`SharedDatabaseModule` from `@photox/data-access`), class-validator DTOs, Swagger, argon2 passwords.
- Workspace deps: `@photox/data-access`, `@photox/shared-auth`, `@photox/shared-config`, `@photox/shared-types` (`workspace:*`). Notable runtime deps: `bullmq` 5.81, `ioredis`, `pg`, `pgvector` 0.2.1, `sharp`, `multer`, `zod`.
- Scripts: `build` (`nest build`), `dev` (`nest start --watch`), `start` (`node dist/main.js`), `clean`, `lint`, `typecheck`, `test` (`vitest run`), `test:watch`. SWC is used by tests only; production build is the Nest CLI.
- `tsconfig.json` extends `../../tsconfig.base.json`, `types: ["vitest/globals", "node"]`, project references to shared-types/config/auth. `tsconfig.build.json` narrows `rootDir: ./src` and excludes `test` + `**/*spec.ts`.
- `vitest.config.ts`: `unplugin-swc` with `parser: { syntax: 'typescript', decorators: true }` (Nest DI needs decorator metadata), `globals: true`, node env, `include: ['src/**/*.spec.ts', 'test/integration/**/*.spec.ts']`.
- `Dockerfile`: multi-stage `node:22-alpine` (deps → build packages then core → runtime), `EXPOSE 3000`, `CMD ["node", "apps/core/dist/main.js"]`.

## Flow

`pnpm dev` (turbo) or compose starts `src/main.ts` → `loadEnv()` (zod) → Nest app on `API_PORT` (3000). Requests: `src/main.ts` conventions → feature controller → service → TypeORM / `BullMqService`. Jobs are consumed by `apps/worker-service`; core never processes them. Integration tests (`test/integration/`) boot feature modules against testcontainers Redis + plain `postgres:16-alpine` (no pgvector, so the HNSW bootstrap only warns).

## Integration

- Inbound: direct HTTP on `API_PORT` (3000; no published Docker port). No CORS; the global `JwtAuthGuard` verifies Bearer HS256 tokens on every route outside the open table.
- Shared state: single Postgres DB `photox`, shared Redis, `STORAGE_DIR` local disk (both core and worker resolve it from the workspace root).
- `pnpm verify` (lint && test && typecheck && build) is the CI gate; `apps/core` is a compose service.
- Core's Swagger at `docs` / `docs-json` is internal-only in compose (port not published); a reverse proxy can expose it when needed.
