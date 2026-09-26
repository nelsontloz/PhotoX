# apps/core/src/persons/

## Responsibility

Named people built from face clusters. `PersonsModule` owns the `persons` table CRUD, the manual cluster trigger, person↔face assignment counts, cover selection, batch reassignment, and the per-person asset rollup. Routes: `api/v1/persons`.

## Design

- `PersonsController` injects `PersonsService` and `BullMqService`. Ownership comes from `req.user.id` with `?? dto.userId` / `?? queryUserId` fallbacks; the `cluster` trigger uses `req.user.id` only.
- `PersonsService` owns `Person`, `Face`, and `Asset` repositories. `Person` (from `@photox/data-access`): uuid PK, indexed `userId`, nullable `name`, nullable `coverFaceId` (plain uuid, no relation), nullable `clusterLabel`, `faceCount` default 0, createdAt/updatedAt.
- `faceCount` is denormalized but treated as a cache: `list` ignores the stored column and recomputes a live count with raw SQL joining `faces` → `assets` filtered by non-trashed (rows sorted by live count desc, then `updatedAt` desc); `getOne` likewise recomputes before returning. `create` stores 0.
- `create(userId, clusterLabel)` is intentionally minimal (id + label) — the cluster worker also writes `Person` rows directly; this endpoint exists for the cluster-job/manual flow. The controller's summary says "Create a person from a face cluster".
- `setCover` validates the person exists, the face exists for that user, and `face.personId === id`, else `ForbiddenException`; it writes `coverFaceId`.
- `reassignFaces(userId, { toPersonId|null, faceIds })` loads the user's faces, sets `personId`, saves in bulk, then recomputes `faceCount` for every affected person; returns `{ moved }`. No `fromPersonId` — the list of face ids is authoritative.
- `getAssetsForPerson` produces one row per asset containing the person via `GROUP BY f."assetId"` with `MIN(f.id)` as a representative `faceId`, `COUNT(*)` faces in that asset, `MAX(createdAt)` as `lastSeen`; ordered `lastSeen DESC`, paginated; `total` is `COUNT(DISTINCT assetId)` over non-trashed assets.
- DTO → response mapping lives in `toListItem`, which builds `coverFaceUrl = /api/v1/faces/<coverFaceId>/thumb?userId=<userId>` (or null).

## Flow

- Cluster: worker `process-faces-cluster` upserts `Person` rows, assigns `face.personId`, sets `coverFaceId` to a representative face, and updates `faceCount`. `POST api/v1/persons/cluster` (202) manually enqueues the same job with a unique `jobId` `cluster-<userId>-manual-<timestamp>` so repeated clicks are not deduped.
- Browse: `GET api/v1/persons?limit&offset` → raw SQL with live counts; `GET api/v1/persons/:id`; `GET api/v1/persons/:id/assets` → asset rollup with a face id for overlay rendering.
- Edit: `PATCH api/v1/persons/:id` (name), `PATCH api/v1/persons/:id/cover`, `POST api/v1/persons/:id/reassign`.
- Face-side edits (`PATCH api/v1/faces/:id/person`) recompute counts in `FacesService`, not here; both paths leave `Person.faceCount` consistent for non-trashed assets.

## Integration

- `PersonsModule` registers `TypeOrmModule.forFeature([Person, Face, Asset])` and exports `PersonsService` (no current importer).
- `Face`/`Person` entities are shared through `@photox/data-access`; `face.personId` is a plain column, so joins and count refresh are explicit SQL, not ORM relations.
- Queue integration via `BullMqService.enqueue('process-faces-cluster', ...)`; consumers run in worker-service and write the same tables directly.
- `/api/v1/persons*` requires a Bearer JWT; `coverFaceUrl` thumbnails hit `api/v1/faces/:id/thumb` which is also JWT-protected but keyed by the embedded `userId`.
