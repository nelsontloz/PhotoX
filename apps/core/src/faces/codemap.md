# apps/core/src/faces/

## Responsibility

Face detection results for assets: storing detected faces (box, confidence, 512-dim embedding, optional person assignment) and serving face crops. Controllers are mounted on `api/v1/assets/:id/faces` (register/delete), `api/v1/faces` (user-wide listing, person assignment) and `api/v1/faces/:id/thumb` (on-demand crop).

## Design

- `FacesModule` registers `FacesController`, `FacesQueryController`, `FaceThumbController` plus `FacesService` and `FaceThumbService`; imports `FacesModule`-local entities `Face`, `Person`, `Asset`, `FileRecord` and `StorageModule`; exports `FacesService` (consumed by `AssetsModule.getOne`).
- `Face` entity (`src/database/entities`): uuid PK, indexed `assetId` and `userId`, `box` jsonb `{x,y,w,h}`, `confidence` real, `embedding` stored as `text` with pgvector transformers (512-dim, `FACE_EMBEDDING_DIM` from `@photox/shared-types`, InsightFace `w600k_r50`), nullable indexed `personId` as a plain uuid column (no TypeORM relation, avoiding a circular import with persons), nullable `detector` provenance (`human`/`scrfd`; null = pre-provenance), `createdAt`.
- `FacesService.registerFaces(assetId, userId, faces, detector?)` verifies asset ownership, then bulk-saves one `Face` per detected face, stamping `detector` on every row. Empty arrays are valid (worker still patches `faceStatus=ready, faceCount=0`).
- `FacesService.deleteForAsset(userId, assetId)` (N2, `DELETE .../faces`) is the transactional replace companion: verifies ownership, deletes the asset's faces, nulls any `Person.coverFaceId` pointing at a deleted face, and refreshes `faceCount` for affected persons; idempotent, returns `{ deleted }`. The worker calls DELETE then POST so a retry cannot duplicate rows.
- `FacesService.assignPerson(userId, faceId, personId|null)` validates face + target person ownership, saves, then refreshes the denormalized `Person.faceCount` for the old and new person via the shared `faces/face-count.ts` helper (count over that person's faces whose asset is not trashed; also used by persons `apply-clusters` and `reassignFaces`).
- Reads: `getForAsset(userId, assetId)` ownership-checked, used internally by `AssetsService.getOne`; `listForUser(userId, includeEmbeddings, excludeTrashed?)` filters by user, optionally returns embeddings for the cluster job, and with `excludeTrashed=true` drops faces on trashed assets (fetch-trashed-asset-ids then filter; no join). Items always include `confidence`.
- `FaceThumbService.getThumb(faceId, userId, size)` crops synchronously with `sharp`: clamps size to 32..600 (default 240), reads the original `FileRecord` from `LocalStorageService.pathFor(storageKey)`, pads the box by 35%, clamps to image bounds, resizes cover, JPEG q82. It requires the caller's `userId` (face + asset + file are all ownership-checked) and sets `Cache-Control: private, max-age=86400`. Crop results are not cached (`ponytail:` comment names a `face_thumbs` table/disk cache as the upgrade path).

## Flow

- Worker (`process-faces`) detects boxes/embeddings with the job's `detector`, then replaces the asset's faces over HTTP: `DELETE api/v1/assets/:id/faces` → `POST api/v1/assets/:id/faces` (carrying the resolved `detector` as provenance); the same job patches `faceStatus/faceCount` on the asset afterwards.
- Cluster job (`process-faces-cluster`, auto-enqueued by `FaceProcessor` on Redis) reads faces via `GET api/v1/faces?includeEmbeddings=true&excludeTrashed=true`, clusters in the worker, then applies ONE plan via `POST api/v1/persons/apply-clusters` (persons module creates/updates `Person` rows, assigns `face.personId`, sets covers and recomputes counts transactionally).
- Manual edits: `PATCH api/v1/faces/:id/person` assigns/unassigns one face; `POST api/v1/persons/:id/reassign` moves batches (persons module recomputes counts via the same helper).
- Rendering: `GET api/v1/faces/:id/thumb?size=...` returns JPEG bytes; person cover URLs embed `/api/v1/faces/<coverFaceId>/thumb?userId=<userId>`.

## Integration

- `FacesModule` is imported by `AssetsModule` (face list on `GET api/v1/assets/:id`) and exports `FacesService`.
- Entities live in `apps/core/src/database/entities`; the HNSW vector index `faces_embedding_hnsw` is created at core bootstrap.
- `face-count.ts` (`refreshPersonFaceCount`) is the single shared non-trashed count refresh, imported by faces, persons and the `apply-clusters` transaction.
- Access: `api/v1/faces*` and `api/v1/assets/:id/faces` require a Bearer JWT; `FaceThumbController` uses `req.user?.id ?? queryUserId` so internal calls can pass `userId`.
- Permitted request shapes live in `apps/core/src/faces/dto/`; the wire types come from `@photox/shared-types` (`FaceDto`, `DetectedFaceInput`, `RegisterFacesRequestDto` with optional `detector` provenance).
