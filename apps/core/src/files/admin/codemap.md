# apps/core/src/files/admin/

## Responsibility

Admin-only file introspection and cleanup: aggregate storage usage per user, and the idempotent blob+row delete the worker's `cleanup-asset` proxies to. Mounted at `api/v1/admin/files/*`.

## Design

- `AdminController` (`@Controller('api/v1/admin/files')`) — `GET storage-stats` (`UserIdsQueryDto` → `Record<userId, bytes>`) and `DELETE :fileId` → 204.
- `AdminService.getStorageStatsByUser(userIds)` runs one QueryBuilder `SELECT f.userId, COALESCE(SUM(f.sizeBytes), 0) ... WHERE userId IN (...) GROUP BY userId`; users with no files are simply absent from the result (no zero-filled entries), and an empty input list returns `{}` without hitting the DB.
- `AdminService.deleteFile(fileId)` has **no owner scoping** (admin surface): missing row → no-op 204; otherwise deletes the blob first (errors log-and-swallow) then removes the row. This is the target of the worker `cleanup-asset` proxy (`DELETE /api/v1/admin/files/:fileId`).
- No ownership or role check exists in this controller: the comment states it "trusts the network". Admin enforcement is central in the global `JwtAuthGuard` (`api/v1/admin/*` requires role `admin`).
- Sizes are summed across all `purpose` values ('original' and 'transcode'), so the number is bytes on disk attributable to the user, not quota-relevant original bytes only.
- `AdminModule` registers `TypeOrmModule.forFeature([FileRecord])` and provides `LocalStorageService`; no providers are exported.

## Flow

- Request: `GET api/v1/admin/files/storage-stats?userIds=u1,u2,u3` (comma-separated, ≤50) → global `JwtAuthGuard` verifies JWT and admin role → core validates the query DTO → grouped `SUM(sizeBytes)`.
- Response: JSON map keyed by userId, e.g. `{ "user-1": 123456 }`; bigint sums are converted with `Number(...)` per row.
- Cleanup: `DELETE api/v1/admin/files/:fileId` → admin token → blob deleted, row removed, 204 whether or not either existed.
- Failure modes: invalid/oversized `userIds` → 400 from the global ValidationPipe; missing `userIds` → empty result, not an error.

## Integration

- Consumes the shared `FileRecord` entity from `@photox/data-access` (`files` table) and `LocalStorageService` from `@photox/shared-config`.
- The `/api/v1/admin/*` prefix is in the admin-only branch of the global `JwtAuthGuard`.
- Request shape comes from `files/admin/dto/user-ids.query.dto.ts`; no response DTO exists (inline record).
