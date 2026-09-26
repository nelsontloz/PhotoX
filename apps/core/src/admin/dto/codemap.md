# apps/core/src/admin/dto/

## Responsibility

Query validation for the admin endpoints in `src/admin/`. One DTO per parameter shape; the only body DTO (`ReprocessThumbnailsDto`) is declared inline in `admin-maintenance.controller.ts`.

## Design

`UserIdsQueryDto` (for `GET api/v1/admin/users/asset-stats`):
- optional `userIds`: `@Transform` splits a comma-separated query string into an array (array values pass through untouched), then `@IsArray`, `@ArrayMinSize(1)`, `@ArrayMaxSize(50)`, `@IsString({ each: true })`.
- No default: the controller passes `q.userIds ?? []`, and `AdminService.getAssetStatsByUser` short-circuits to `{}` for an empty list.

`ListAdminAssetsQueryDto` (for `GET api/v1/admin/assets`):
- `kind` required `@IsIn(['photo', 'video'])`.
- `limit` optional int 1–500 (`@Type(() => Number)`); controller default 200.
- `offset` optional int ≥ 0.

Both rely on the global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) and carry `@ApiProperty` metadata for `/docs`.

## Flow

Query string → `ValidationPipe` transform+validate → DTO → controller → `AdminService` / `AdminAssetsService.listForReprocess`.

## Integration

- The 500 max matches the maintenance reprocess page size (`limit = 500` in `admin-maintenance.controller.ts`) and the shared-types pagination contract.
- `kind` mirrors `Asset.kind` in `@photox/data-access`; `userIds` values are opaque UUIDs correlated with `GET api/v1/admin/users` output by the web client.
