# apps/gateway/src/auth/

## Responsibility
- Edge authentication: one global guard that either lets a request through open, or verifies the Bearer JWT and attaches `GatewayIdentity` (`{ id, email, role }`) to `req.user` for the proxy to forward as headers.
- Files:
  - `open-routes.ts` — open/admin path predicates (`isOpenRoute`, `isAdminRoute`).
  - `gateway-auth.guard.ts` — `GatewayAuthGuard`, `GatewayIdentity`, `IdentityRequest`.
  - `auth.module.ts` — JwtModule secret + `APP_GUARD` registration.
  - `gateway-auth.guard.spec.ts`, `open-routes.spec.ts` — behavior + parity tables.

## Design
- `isOpenRoute(method, path)` — exact table, only one regex:
  - `path.startsWith('/docs')` (covers `/docs`, `/docs-json`, `/docs/extra`), any method.
  - `path === '/health'` only (no `/health/extra`).
  - `path === '/api/v1/auth'` or `/api/v1/auth/...`.
  - `path === '/api/share'` or `/api/share/...`.
  - `GET` and `^/api/v1/files/[^/]+/stream$` — single path segment, GET only.
- `isAdminRoute(path)` — `/api/v1/admin` or `/api/v1/admin/...`.
- `GatewayAuthGuard.canActivate`:
  - Open check runs before any token work → `return true`.
  - Parses `Authorization: Bearer <token>` (scheme case-insensitive; malformed → treated as missing → 401).
  - `jwt.verify` pinned to `algorithms: ['HS256']` with `clockTolerance` = `AUTH_CLOCK_TOLERANCE_SEC` (60s); the injected `JwtService` secret comes from `loadAuthEnv()`.
  - Any verify failure → `UnauthorizedException` (401); success → identity `{ id: payload.sub, email, role }` on `req.user`.
  - Admin check runs *after* verification: non-admin on `/api/v1/admin/*` → 403 `Admin only`, unauthenticated → 401.
- `auth.module.ts` uses `JwtModule.registerAsync` deliberately: the factory runs after ConfigModule loads root `.env`; a top-level `loadAuthEnv()` at import time would crash host dev.
- `GatewayAuthGuard` is registered both as a class and as `{ provide: APP_GUARD, useClass: GatewayAuthGuard }` → global.
- Open table duplicated in `apps/core/src/auth/gateway-identity.guard.ts` (no cross-app imports); `open-routes.spec.ts` pins parity rows and core has a twin table.

## Flow
- Request → `GatewayAuthGuard.canActivate`: open? return true; else Bearer + HS256 verify → `req.user` set → admin path + non-admin → 403 → controller.
- `IdentityRequest` is consumed by `ProxyService`, which synthesizes the `x-user-*` upstream headers from `req.user`.

## Integration
- Consumes `@photox/shared-auth` (`loadAuthEnv`, `JwtPayload`) and `@photox/shared-config` (`loadEnv` clock tolerance); `Role` from `@photox/shared-types`.
- Trust boundary: client `x-user-*` / `userId` are never trusted, and this guard's output is the only identity source.
- Core's `GatewayIdentityGuard` re-reads the forwarded headers — the two open tables must stay aligned.
