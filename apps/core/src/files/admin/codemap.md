# apps/core/src/files/admin/

## Responsibility

Admin-only file introspection: aggregate storage usage per user. Mounted at `api/v1/admin/files/storage-stats`; this is the only endpoint in the folder.

## Design

- `AdminController` (`@Controller('api/v1/admin/files')`) — single `GET storage-stats` handler taking `UserIdsQueryDto` and returning `Record<userId, bytes>`.
- `AdminService.getStorageStatsByUser(userIds)` runs one QueryBuilder `SELECT f.userId, COALESCE(SUM(f.sizeBytes), 0) ... WHERE userId IN (...) GROUP BY userId`; users with no files are simply absent from the result (no zero-filled entries), and an empty input list returns `{}` without hitting the DB.
- No ownership or role check exists in core: the controller comment states it "trusts the network". Admin enforcement is at the gateway edge (`api/v1/admin/*` is admin-only in `GatewayAuthGuard`), which is acceptable because core publishes no port.
- Sizes are summed across all `purpose` values ('original' and 'transcode'), so the number is bytes on disk attributable to the user, not quota-relevant original bytes only.
- `AdminModule` registers only `TypeOrmModule.forFeature([FileRecord])`; no providers are exported.

## Flow

- Request: `GET api/v1/admin/files/storage-stats?userIds=u1,u2,u3` (comma-separated, ≤50) → gateway verifies JWT and admin role → core validates the query DTO → grouped `SUM(sizeBytes)`.
- Response: JSON map keyed by userId, e.g. `{ "user-1": 123456 }`; bigint sums are converted with `Number(...)` per row.
- Failure modes: invalid/oversized `userIds` → 400 from the global ValidationPipe; missing `userIds` → empty result, not an error.

## Integration

- Consumes the shared `FileRecord` entity from `@photox/data-access` (`files` table).
- Exterior entry only through the gateway proxy; the `/api/v1/admin/*` prefix is in the admin-only branch of `GatewayAuthGuard`, so no `AdminGuard` is needed inside core.
- Request shape comes from `files/admin/dto/user-ids.query.dto.ts`; no response DTO exists (inline record).
