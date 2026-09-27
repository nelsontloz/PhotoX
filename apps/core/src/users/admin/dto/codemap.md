# apps/core/src/users/admin/dto/

## Responsibility

Validation and transformation contract for `GET /api/v1/admin/users` query parameters.

## Design

Single DTO `ListAdminUsersQueryDto` (no shared-types interface — the response wire type lives in `@photox/shared-types`, the request is internal):

- `limit`: optional int 1–50, `@Type(() => Number)` coerces the query string; controller applies default 20.
- `offset`: optional int ≥ 0; controller default 0.
- `q`: optional string ≤ 100 chars; `AdminService` consumes it as `%q%` ILIKE over `email`/`displayName`.
- `sort`: optional `@Matches(/^(createdAt|displayName|email|role):(asc|desc)$/)`. This regex is the injection guard for the `orderBy` interpolation in `AdminService.parseSort` — do not loosen it without changing that service.
- `role`: optional `@IsEnum(['user', 'admin'])`.

Every property carries `@ApiProperty` (defaults, bounds, example) for `/docs`. The global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) rejects unknown query params and makes the `@Type` coercion effective.

## Flow

Query string → Express → global `ValidationPipe` transform+validate → `ListAdminUsersQueryDto` → `AdminController.list` calls `AdminService.parseSort(q.sort)` then passes `{ limit, offset, q, sortField, sortDir, role }` to `AdminService.listUsers`.

## Integration

Used only by `users/admin/admin.controller.ts`. The `sort` whitelist must stay in sync with `AdminUserSortField` in `@photox/shared-types` and with the columns selected in `AdminService` (sorting on a non-selected column would be a SQL error).
