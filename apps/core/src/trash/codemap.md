# apps/core/src/trash/

## Responsibility

Permanent-deletion and restore endpoints for trashed assets. Soft-delete (trashing) lives in `assets/`; this module owns the `DELETE`/restore half of the trash lifecycle.

## Design

`TrashModule` imports `AssetsModule` (which exports `AssetsService`) and declares only `TrashController` — no service, repository, or DTOs. All routes attach to `api/v1/assets`, the same base path as `AssetsController`, differentiated by the `trashed` segment:

- `DELETE api/v1/assets/trashed` → `AssetsService.emptyTrash(userId)` — permanently deletes every trashed asset of the user; returns `{ fileIds }`.
- `DELETE api/v1/assets/trashed/:id` → `AssetsService.delete(userId, id)` — 404 if absent/foreign, 400 `Asset must be trashed before permanent deletion` if `!asset.isTrashed`; returns `{ fileIds }`.
- `POST api/v1/assets/trashed/:id/restore` → 204, idempotent (`restore` only updates when `isTrashed`).

Every handler resolves `userId` from `(req.user as { id: string }).id` (populated by the global `JwtAuthGuard`) with a `@Query('userId')` fallback for service-to-service/legacy calls. Swagger tag `trashed`.

`AssetsService` permanent deletion (the real logic):

- Collects file ids **before** deleting: asset `fileId`, optional `transcodeFileId`, and every `AssetThumbnail.fileId`.
- One transaction deletes `Face`, `AlbumAsset`, `AssetShare`, then the `Asset` rows.
- Returns the file ids to the caller; it does **not** enqueue a `cleanup-asset` job (worker-service has the consumer, but trash doesn't use it) and does not touch local storage — blob reclamation is the caller's/admin's job.
- Album/share/face rows are only removed at permanent-delete time, so restoring a trashed asset before that keeps its links intact.

## Flow

Bearer JWT → global `JwtAuthGuard` → `TrashController` → `AssetsService` → Postgres transaction → `{ fileIds }` response. Listing trashed items is NOT here: `GET api/v1/assets/trashed` lives in `assets/assets.controller.ts` (`listTrashed`).

## Integration

- The web trash page calls these via `apps/web/src/api/assets.ts` (`emptyTrash`, `deleteAsset`, `restoreAsset`) and currently ignores the returned file ids.
- `GET api/v1/admin/orphan-counts` + `POST api/v1/admin/cleanup-orphans` (worker `cleanup-orphans`) is the existing path for reclaiming unreferenced storage rows/blobs.
- Depends on `AssetsModule`'s exported service; no own providers means no repository coupling.
