# apps/core/src/users/admin/

## Responsibility

Admin-only, paginated listing of user accounts for the web admin console: `GET /api/v1/admin/users`.

## Design

- `AdminController` is `@UseGuards(AdminGuard)` + `@Controller('api/v1/admin/users')`, Swagger tag `admin`. Its operation summary says "trusts the network" — the global `JwtAuthGuard` is the JWT/admin boundary; this controller-level guard is redundant defence in depth.
- Swagger: `@ApiTags('admin')` at controller level, one `@ApiOperation`/`@ApiResponse({ status: 200 })` on the single route (403/`Admin only` comes from the guard, not documented).
- `AdminService.listUsers` builds a `SelectQueryBuilder<User>` selecting only `id, displayName, email, role, createdAt`, applies filters, sorts, then `take(limit).skip(offset)` with `getManyAndCount()`.
- `AdminService.parseSort(sort)` static helper parses `field:dir` (e.g. `createdAt:desc`), defaulting to `{ createdAt, desc }`. The field is interpolated directly into `orderBy(\`u.${field}\`)`; this is safe only because `ListAdminUsersQueryDto` regex-whitelists the four allowed fields.
- Filters: `q` → `(u.email ILIKE :like OR u.displayName ILIKE :like)` with `%q%`; `role` → exact match. Controller defaults `limit=20`, `offset=0`.
- Response `AdminUserListResponse` (`{ items, total, limit, offset }`); each `AdminUserRow` carries `assetCount: 0` and `bytesUsed: 0` placeholders. Real per-user counts come from `GET /api/v1/admin/users/asset-stats` in `src/admin/`, which the client combines with this list.

## Flow

Admin Bearer JWT → global `JwtAuthGuard` verifies and populates `req.user` → `AdminGuard` passes → controller parses sort → `AdminService.listUsers` → Postgres → `getManyAndCount()` → rows mapped to wire shape with `createdAt.toISOString()`.

## Integration

- `AdminGuard` from `src/auth/admin.guard.ts`; `User` entity from `users/entities/`.
- Wire types `AdminUserListResponse`, `AdminUserRow`, `AdminUserSortField` from `@photox/shared-types` — shared with the web admin users page.
- No separate `Module` class: the controller and service are registered directly in `users/users.module.ts`.
- List-only folder: there are no create/role-change/delete endpoints for users anywhere in core today.
