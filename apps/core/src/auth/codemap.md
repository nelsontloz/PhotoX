# apps/core/src/auth/

## Responsibility

Core-side identity and authorization. Rebuilds `req.user` from the gateway-injected `x-user-*` headers on every non-open route, and provides the role gate (`AdminGuard`) for admin controllers. Core never verifies JWTs — that is exclusively the gateway's job.

## Design

- `AuthModule` has no auth-flow controllers. Its only provider is `{ provide: APP_GUARD, useClass: GatewayIdentityGuard }`, making identity enforcement global.
- `GatewayIdentityGuard` duplicates the gateway's open-route table locally (`isOpenRoute`), because there are no cross-app runtime imports. The table is copied from `apps/gateway/src/auth/open-routes.ts` and pinned by twin spec tables (`gateway-identity.guard.spec.ts` ↔ `apps/gateway/src/auth/open-routes.spec.ts`) that must stay identical:
  - `/docs*`
  - `GET /health` (exact; `/health/extra` is protected)
  - `/api/v1/auth` and `/api/v1/auth/*`
  - `/api/share` and `/api/share/*`
  - `GET /api/v1/files/:fileId/stream` (single path segment regex; POST or nested paths are protected)
- On protected routes it reads `x-user-id`, `x-user-email`, `x-user-role`; any missing/non-string → `UnauthorizedException` with the default shape `{ statusCode: 401, message: 'Unauthorized' }`. `Authorization: Bearer ...` is explicitly ignored (the spec asserts this).
- `req.user` augmentation lives on the Express `Request` namespace: `{ id: string; email: string; role: Role }` — a ponytail replacement for the removed passport augmentation.
- `AdminGuard` is NOT global: controllers opt in with `@UseGuards(AdminGuard)`. It throws `ForbiddenException('Admin only')` when `req.user?.role !== 'admin'`, so it depends on the global identity guard having run first.

## Flow

1. Gateway verifies the access JWT and forwards `x-user-id/email/role` (client-supplied `userId` has been stripped).
2. Global `GatewayIdentityGuard` short-circuits open routes or populates `req.user`; missing identity 401s before any controller code.
3. Controllers read `(req.user as { id: string }).id`; admin controllers additionally pass `AdminGuard`.
4. `gateway-identity.guard.spec.ts` asserts the full method+path parity table, the 401 shape, Bearer-ignore, and header→`req.user` mapping.

## Integration

- Gateway is the only writer of `x-user-*`; core trusts it implicitly (internal network, no published port).
- `AdminGuard` is used by `users/admin/admin.controller.ts` and `admin/admin-maintenance.controller.ts`. `admin/admin.controller.ts` and `admin/admin-assets.controller.ts` intentionally have no core guard because the gateway already enforces admin on all `api/v1/admin/*`.
- Depends only on `Role` from `@photox/shared-types`; no DB, Redis, or JWT dependencies.
