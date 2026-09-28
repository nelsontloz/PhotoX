# apps/core/src/files/admin/dto/

## Responsibility

The single admin query shape: `UserIdsQueryDto` for `GET api/v1/admin/files/storage-stats` (`DELETE /api/v1/admin/files/:fileId` takes a path param only).

## Design

- `userIds?: string[]` arrives as a comma-separated query string and is split by a `@Transform` (`value.split(',').filter(Boolean)`) before validation.
- Validation: `@IsOptional()`, `@IsArray()`, `@ArrayMinSize(1)`, `@ArrayMaxSize(50)`, `@IsString({ each: true })`.
- Values are **not** UUID-validated — arbitrary user-id strings are accepted and simply won't match rows in the grouped query.
- No `userId` fallback field (unlike other DTOs) and no response DTO: the endpoint returns an ad-hoc `Record<string, number>`.
- Swagger documents it as `type: String` with a comma-separated example so the docs match the raw query format, not the transformed array.
- This is the only DTO in `files/admin/dto/`; the folder is not registered as a Nest module.

## Flow

- Request `?userIds=uuid1,uuid2` → global `ValidationPipe` (whitelist + transform) → `@Transform` splits → array validation → `AdminService.getStorageStatsByUser`.
- Empty string after filtering (`userIds=`) fails `ArrayMinSize(1)` → 400; omitting the parameter entirely passes and yields `{}`.
- More than 50 ids → 400 before any SQL is built.

## Integration

- Consumed only by `AdminController (api/v1/admin/files)`.
- Enforced admin-only centrally by `JwtAuthGuard` (`/api/v1/admin/*`); the controller itself has no guard.
