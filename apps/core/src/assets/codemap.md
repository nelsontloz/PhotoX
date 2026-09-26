# apps/core/src/assets/

## Responsibility

`AssetsModule` is the asset domain: one `Asset` row per uploaded photo/video, its metadata, favorites, soft-delete lifecycle, thumbnail registrations, and the asset↔file link (`Asset.fileId`). It exposes `api/v1/assets` (and the thumbnail sub-resources). Permanent-delete/restore/empty-trash endpoints are routed in `apps/core/src/trash` but implemented by `AssetsService` here.

## Design

- Two controllers share the `api/v1/assets` prefix:
  - `AssetsController`: `POST /` create from a `fileId`, `GET /` filtered list, `GET /by-file/:fileId` (service-to-service), `PATCH /:id/metadata` (worker callback), `GET /trashed`, `GET /:id`, `PATCH /:id`, `POST /:id/trash`, `POST /bulk-trash`. Static/child routes are declared before `:id` to avoid route shadowing.
  - `ThumbnailsController`: `POST /:id/thumbnails` (idempotent upsert on `assetId+size`), `DELETE /:id/thumbnails/:size`, `GET /:id/thumbnails`, `GET /:id/thumbnails/:size`.
- `AssetsService` owns `Asset`, `AssetThumbnail`, `DataSource`, and `FacesService`; it deletes `Face`, `AlbumAsset`, `AssetShare` rows in the same transaction as `Asset` when purging.
- `create` sets lifecycle defaults: `thumbnailStatus: 'pending'` always, `transcodeStatus: 'pending'` for videos; the file itself must already exist (`fileId` is not validated against `FileRecord` here — the upload service creates it first).
- `list` builds a QueryBuilder with optional `kind`, MIME prefix (`LIKE 'prefix%'`), date window (`takenAt` falling back to `uploadedAt` when NULL), `favorite`, `metadataStatus`, `hasFaces` (`faceCount > 0` / null-or-0), `hasLocations`; ordered `COALESCE(takenAt, uploadedAt) DESC, uploadedAt DESC`; returns `{ items, total, limit, offset }`.
- `update` only accepts the user-editable subset (`title`, `description`, `takenAt`, `favorite`) — never status/EXIF fields; `updateMetadata` is the separate worker callback for extracted EXIF/video/transcode/face fields and bumps `metadataExtractedAt` when `status` is sent.
- Trash is idempotent: `trash` no-ops when already trashed; `bulkTrash` is a single `UPDATE ... WHERE id IN (...) AND userId`. `restore` no-ops when not trashed.
- `delete` (permanent) requires `isTrashed` first (400 otherwise); it collects the original fileId, `transcodeFileId`, and all thumbnail fileIds to return to the caller for storage cleanup, then deletes Face/AlbumAsset/AssetShare/Asset in a transaction. `emptyTrash` does the same for every trashed asset of the user.
- `getOne(userId | undefined, id)` skips the ownership clause when `userId` is falsy; `toResponse` converts bigint/numeric columns to JS numbers and dates to ISO strings.

## Flow

- Upload path: `UserFilesService.upload` creates the file record then calls `AssetsService.create`, then enqueues thumbnails/metadata/faces/video. This folder does not enqueue jobs itself.
- Metadata path: worker patches via `PATCH api/v1/assets/:id/metadata`, setting dimensions/EXIF/GPS/`transcodeFileId`/`thumbnailStatus`/`faceStatus`/`faceCount`.
- Read path: `GET api/v1/assets/:id` loads the asset then attaches `faces` from `FacesService.getForAsset`.
- Delete path: trash → purge returns `{ fileIds }`; storage objects are deleted by the caller (cleanup worker consumes the returned ids), DB rows are removed transactionally here.
- Thumbnails are registered by the thumbnail worker after writing the derivative and its `FileRecord`; `GET :id/thumbnails/:size` is how the web layer resolves the thumbnail `fileId` for rendering.

## Integration

- `AssetsModule` imports `TypeOrmModule.forFeature([Asset, AssetThumbnail])` + `FacesModule`, exports `AssetsService` consumed by `UserFilesModule` (upload), `TrashModule` / `apps/core/src/trash`, and `SharesModule` (asset lookups).
- Deletion is coordinated with the queue: `cleanup-asset` / `cleanup-orphans` consumers in worker-service physically delete storage keys; core only returns ids. `admin-maintenance.controller.ts` can enqueue `cleanup-orphans`.
- Exterior traffic reaches these routes through the gateway (`/api/v1/assets*` requires JWT); `GET api/v1/assets/by-file/:fileId` and `PATCH :id/metadata` are intended for internal/service callers, but they sit on the same JWT-protected external path.
