# apps/core/src/albums/

## Responsibility

`AlbumsModule` owns user-curated albums over existing assets: album CRUD plus membership add/remove/list. Public surface is `api/v1/albums` (internal :3000; gateway requires a JWT). Albums are strictly per-user (`Album.userId`); there is no cross-user membership or album sharing.

## Design

- `AlbumsController` is thin: extracts `req.user.id` (set globally by `GatewayIdentityGuard` from `x-user-id`) with `?? dto.userId` / `?? queryUserId` fallbacks so worker/service callers can pass an explicit user.
- `AlbumsService` is the only owner of the two repositories; every read/write scopes by `userId`, returning `NotFoundException` on mismatch (not 403).
- `Album` rows store name/description only. `assetCount` is never persisted: `list` runs one grouped join over `album_assets` + `assets` filtered by `asset.isTrashed = false`; `getOne`/`update` call `countAssets`; `create` returns 0.
- `AlbumAsset` uses a composite PK (`albumId`, `assetId`) so membership is deduplicated at the DB level; `addAssets` additionally uses `.orIgnore()` for idempotent re-adds. There are no TypeORM relations — joins are done with raw table names (`album_assets`, `assets`).
- `addAssets` validates each asset belongs to the caller and is not trashed before inserting; all-or-nothing on the validation pass.
- `listAssets` pages the join ordered by `addedAt DESC`, then re-fetches `Asset` rows and restores the join order with an index map (TypeORM `In()` does not preserve order).
- `delete(album)` removes only the album row; `album_assets` rows are left (no FK/relation cascade).

## Flow

- Create: `POST api/v1/albums` → `repo.save` → `AlbumDto` with `assetCount: 0`.
- List: `GET api/v1/albums?limit&offset` → `findAndCount` by userId, then per-album non-trashed counts → `{ items, total }`.
- Read/update/delete: `GET|PATCH|DELETE api/v1/albums/:id`; `PATCH` supports partial name/description (empty patch short-circuits to a read); `DELETE` → 204.
- Membership: `POST api/v1/albums/:id/assets` body `{ assetIds[] }` → `{ added: n }`; `DELETE api/v1/albums/:id/assets/:assetId` → 204; `GET api/v1/albums/:id/assets` with raw `limit`/`offset` query params (not DTO-validated).
- Permanent asset deletion (`apps/core/src/trash`, backed by `AssetsService.emptyTrash`/`delete`) deletes matching `AlbumAsset` rows inside its transaction.

## Integration

- `AlbumsModule` imports `TypeOrmModule.forFeature([Album, AlbumAsset, Asset])` and exports `AlbumsService` (currently no other module consumes it).
- Exterior access only via the gateway proxy: `/api/v1/albums*` is JWT-protected (not in the open table).
- Asset-side cascade cleanup lives in `apps/core/src/assets/assets.service.ts`, not in this module; worker-service never touches album tables.
