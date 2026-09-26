# apps/core/src/faces/

## Responsibility

Face detection results for assets: storing detected faces (box, confidence, 512-dim embedding, optional person assignment) and serving face crops. Controllers are mounted on `api/v1/assets/:id/faces` (read/register), `api/v1/faces` (user-wide listing, person assignment) and `api/v1/faces/:id/thumb` (on-demand crop).

## Design

- `FacesModule` registers `FacesController`, `FacesQueryController`, `FaceThumbController` plus `FacesService` and `FaceThumbService`; imports `FacesModule`-local entities `Face`, `Person`, `Asset`, `FileRecord` and `StorageModule`; exports `FacesService` (consumed by `AssetsModule.getOne`).
- `Face` entity (`@photox/data-access`): uuid PK, indexed `assetId` and `userId`, `box` jsonb `{x,y,w,h}`, `confidence` real, `embedding` stored as `text` with pgvector transformers (`FACE_EMBEDDING_DIM = 512`, InsightFace `w600k_r50`), nullable indexed `personId` as a plain uuid column (no TypeORM relation, avoiding a circular import with persons), `createdAt`.
- `FacesService.registerFaces(assetId, userId, faces)` verifies asset ownership, then bulk-saves one `Face` per detected face. Empty arrays are valid (worker still patches `faceStatus=ready, faceCount=0`).
- `FacesService.assignPerson(userId, faceId, personId|null)` validates face + target person ownership, saves, then refreshes the denormalized `Person.faceCount` for the old and new person (count over that person's faces whose asset is not trashed).
- Reads: `getForAsset(assetId)` has **no ownership check** (used internally by `AssetsService.getOne` and the `api/v1/assets/:id/faces` route); `listForUser(userId, includeEmbeddings)` filters by user and optionally returns embeddings for the cluster job.
- `FaceThumbService.getThumb(faceId, userId, size)` crops synchronously with `sharp`: clamps size to 32..600 (default 240), reads the original `FileRecord` from `LocalStorageService.pathFor(storageKey)`, pads the box by 35%, clamps to image bounds, resizes cover, JPEG q82. It requires the caller's `userId` (face + asset + file are all ownership-checked) and sets `Cache-Control: private, max-age=86400`. Crop results are not cached (`ponytail:` comment names a `face_thumbs` table/disk cache as the upgrade path).

## Flow

- Worker (`process-faces`) detects boxes/embeddings, then `POST api/v1/assets/:id/faces` registers them; the same job patches `faceStatus/faceCount` on the asset afterwards.
- Cluster job (`process-faces-cluster`, auto-enqueued by `FaceProcessor`) reads faces via `GET api/v1/faces?includeEmbeddings=true`, groups them, creates/updates `Person` rows, assigns `face.personId`, and updates `Person.faceCount`.
- Manual edits: `PATCH api/v1/faces/:id/person` assigns/unassigns one face; `POST api/v1/persons/:id/reassign` moves batches (persons module recomputes counts itself).
- Rendering: `GET api/v1/faces/:id/thumb?size=...` returns JPEG bytes; person cover URLs embed `/api/v1/faces/<coverFaceId>/thumb?userId=<userId>`.

## Integration

- `FacesModule` is imported by `AssetsModule` (face list on `GET api/v1/assets/:id`) and exports `FacesService`.
- Entities live in `packages/data-access`; the HNSW vector index `faces_embedding_hnsw` is created at core bootstrap.
- Gateway: `api/v1/faces*` and `api/v1/assets/:id/faces` require JWT; `FaceThumbController` uses `req.user?.id ?? queryUserId` so internal calls can pass `userId`.
- Permitted request shapes live in `apps/core/src/faces/dto/`; the wire types come from `@photox/shared-types` (`FaceDto`, `DetectedFaceInput`, `RegisterFacesRequestDto`).
