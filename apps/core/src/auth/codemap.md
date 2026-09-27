# apps/core/src/auth/

## Responsibility

Core identity and authorization. The global `JwtAuthGuard` verifies the Bearer HS256 access token on every non-open route, populates `req.user`, and rejects non-admins on `api/v1/admin*`. `AdminGuard` remains as an opt-in, redundant role gate on some controllers.

## Design

- `AuthModule` has no auth-flow controllers. It registers `JwtModule.registerAsync` (secret from `loadAuthEnv().AUTH_TOKEN_SECRET`) and `{ provide: APP_GUARD, useClass: JwtAuthGuard }`, making token verification global.
- `JwtAuthGuard` classifies routes via `open-routes.ts` (`isOpenRoute` / `isAdminRoute`) — the single source of truth, no duplicated table:
  - `/docs*`
  - `GET /health` (exact; `/health/extra` is protected)
  - `/api/v1/auth` and `/api/v1/auth/*`
  - `/api/share` and `/api/share/*`
  - `GET /api/v1/files/:fileId/stream` (single path segment regex; POST or nested paths are protected)
- On protected routes it reads `Authorization: Bearer <token>`; a missing token → `UnauthorizedException` with the default shape `{ statusCode: 401, message: 'Unauthorized' }`.
- Verification is `jwt.verify<JwtPayload>(token, { algorithms: ['HS256'], clockTolerance: loadEnv().AUTH_CLOCK_TOLERANCE_SEC })`; an invalid/expired token gets the same 401. Incoming identity headers are ignored entirely — only the verified token can set identity.
- On success `req.user = { id: payload.sub, email: payload.email, role: payload.role }` (Express `Request` namespace augmentation lives in this folder).
- Admin enforcement is central: `isAdminRoute(path)` + `role !== 'admin'` → `ForbiddenException('Admin only')` before any controller code runs.
- `AdminGuard` is NOT global: controllers opt in with `@UseGuards(AdminGuard)` as redundant defence; it throws `ForbiddenException('Admin only')` when `req.user?.role !== 'admin'`.

## Flow

1. Client sends `Authorization: Bearer <access token>`.
2. Global `JwtAuthGuard` short-circuits open routes or verifies the token and populates `req.user`; missing/invalid identity 401s before any controller code, non-admin on `/api/v1/admin*` 403s.
3. Controllers read `(req.user as { id: string }).id`; some admin controllers additionally pass `AdminGuard`.
4. `jwt-auth.guard.spec.ts` asserts the open/admin behavior, 401/403 shapes, spoofed-header rejection, and header→`req.user` mapping.

## Integration

- Guard dependencies: `JwtService` from `AuthModule`'s `JwtModule.registerAsync`, plus `loadEnv()` for the clock tolerance.
- `AdminGuard` is used by `users/admin/admin.controller.ts` and `admin/admin-maintenance.controller.ts`; the central guard already enforces admin on all `api/v1/admin/*`, so those are defence in depth.
- Depends on `JwtPayload` from `@photox/shared-auth` and `Role` from `@photox/shared-types`; no DB or Redis.
