# apps/gateway/

## Responsibility
- `@photox/gateway`: stateless NestJS edge service and the sole exterior API surface (published :3001).
- It verifies the HS256 access JWT, discards client-supplied identity, and fetch-pipes every `/api/*` request to core.
- No DB, queue, storage, or shared runtime state; the only upstream is core over HTTP.
- Owns the app's build/test wiring:
  - `nest-cli.json` — sourceRoot `src`, swagger plugin, deleteOutDir.
  - `tsconfig.build.json` — rootDir `src`, excludes `test`, `dist`, `**/*spec.ts`.
  - `vitest.config.ts` — node env, `globals: true`, `include: src/**/*.spec.ts`, `passWithNoTests`.

## Design
- Plain pnpm/turbo workspace package (`@photox/gateway`, private, v0.0.1). Dependencies: NestJS 11 (`common`, `core`, `platform-express`, `config`, `jwt`, `swagger`), `class-transformer`/`class-validator` for the global pipe, `reflect-metadata`, `rxjs`, plus `@photox/shared-auth|config|types` as `workspace:*`.
- Deliberately absent: TypeORM, BullMQ, storage deps — stateless by construction.
- `tsconfig.json` extends `tsconfig.base.json`, sets `outDir: dist` and `types: [vitest/globals, node]`, includes `src` + `test`, and declares project references to the three shared packages so `tsc --noEmit` resolves their built declarations.
- Unit tests are co-located (`src/**/*.spec.ts`) and pure — `fetch`/`JwtService` stubbed, no testcontainers, no DB.
- Scripts: `build` (`nest build` → `dist/main.js`), `dev` (`nest start --watch`), `start` (`node dist/main.js`), `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:watch`.

## Flow
- `pnpm build` → nest reads `tsconfig.build.json` → emits `dist/`; compose/containers run `node dist/main.js`.
- `pnpm test` → Vitest discovers only co-located specs under `src/`; helpers (`open-routes`, `proxy.utils`) and guard/service behavior are verified without booting Nest.

## Integration
- Workspace member consumed by root `pnpm verify` (typecheck → lint → test → build) and turbo.
- Runtime consumers: `apps/web` (Vite proxy → :3001) and external clients.
- Upstream: core at `CORE_BASE_URL` (default `http://localhost:3000`), health-probed by `src/health/`.
- The open-route table is intentionally duplicated in `apps/core/src/auth/gateway-identity.guard.ts` — no cross-app imports; both copies must stay in sync.
