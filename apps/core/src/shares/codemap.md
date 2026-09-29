# apps/core/src/shares/

## Responsibility

Public capability-URL sharing of single assets. Two controllers: authenticated management at `api/v1/shares` (`SharesController`) and unauthenticated consumption at `api/share` (`PublicSharesController` — token in the path is the only credential). One share per `(userId, assetId)`, revocable.

## Design

- `SharesService` owns `AssetShare` + `Asset` repositories. `AssetShare`: uuid PK, indexed `userId`, unique-indexed `token` varchar(32), `ManyToOne(Asset, onDelete: 'CASCADE')` via `assetId`, `createdAt`.
- `create(userId, dto)`: asset must exist, be owned, and not be trashed (404 otherwise); if a share for the asset already exists it is returned unchanged (idempotent — no token rotation). New tokens are `crypto.randomBytes(16).toString('base64url')` (22 chars).
- `list(userId)`: QueryBuilder joins `share.asset` and `asset.thumbnails`, filters `asset.isTrashed = false`, orders `createdAt DESC`. Despite the Swagger summary saying "Paginated", there is no limit/offset and the response is `{ items }` only.
- `revoke(userId, shareId)`: delete by `{id, userId}` (404 if not the owner).
- `getByToken(token)`: looks up by unique token with the `asset` relation; 404 if absent or if `asset.isTrashed`. Returns `PublicShareResponse = { share, asset }` where `asset` is a deliberately reduced projection: `id`, `userId`, `kind`, `fileId`, `title`, `originalName`, `mimeType`, `width`, `height`, `durationSeconds`, `takenAt`. No EXIF/GPS/faces leak into the public payload.
- `toDto` decorates the share with `assetFileId`, `assetThumbFileId` (the `sm` thumbnail's fileId if present), and `assetKind` for listing UIs.
- `PublicSharesController` reuses `UserFilesService` for bytes: `GET api/share/:token` (metadata) and `GET api/share/:token/stream` (bytes by `share.asset.fileId`), with the same `parseRangeHeader` logic as user files: 416 + `Content-Range: bytes */total` when unsatisfiable, 206 with `Content-Range`/`Content-Length` when ranged, 200 full-stream otherwise (no `Content-Disposition` attachment header here).
- The same token lookup is also exposed on the authenticated controller as `GET api/v1/shares/public/:token`.

## Flow

- Share: `POST api/v1/shares { assetId }` (JWT) → dedupe/create → `AssetShareDto` containing the token.
- Consume: `GET api/share/:token` (no auth; `JwtAuthGuard` whitelists the whole `/api/share/*` prefix) → public asset projection; `GET api/share/:token/stream` → file bytes with Range support, used directly as a media URL.
- Manage: `GET api/v1/shares` (list with thumbnail info), `DELETE api/v1/shares/:id` (revoke). Revoking deletes only the share row; asset/file bytes are untouched.
- Trashing or permanently deleting an asset removes visibility: trashed assets are excluded by `list`/`getByToken`; permanent delete removes `AssetShare` rows inside `AssetsService`'s transaction (also covered by the FK cascade).

## Integration

- `SharesModule` imports `TypeOrmModule.forFeature([AssetShare, Asset])` + `UserFilesModule` (for `UserFilesService` streaming) and registers both controllers.
- `Asset` entity comes from `../database/entities`; `LocalStorageService` (used indirectly through `UserFilesService`) from `@photox/shared-config`.
- Open routes: `api/share` and `api/share/:token/stream` (`apps/core/src/auth/open-routes.ts`); `api/v1/shares*` requires a Bearer JWT. Range/206/416 pass through.
- DTOs in `shares/dto/`; entity in `shares/entities/`; wire types `AssetShareDto`, `ShareListResponse`, `PublicShareResponse` in `@photox/shared-types`.
