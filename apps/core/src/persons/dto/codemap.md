# apps/core/src/persons/dto/

## Responsibility

Request shapes for the `api/v1/persons` endpoints: create, rename, cover selection, batch face reassignment, the worker cluster-plan apply, and the pagination query reused by list and per-person assets.

## Design

- `CreatePersonDto`: required `clusterLabel` string (≤200). `name` is intentionally absent — new persons are unnamed until renamed.
- `ApplyClustersDto` (worker E3 `POST /apply-clusters`): `creates` and `attaches` arrays are **both required** (worker always sends them, `[]` when empty); each create is `{ clusterLabel ≤200, faceIds ≥1 UUID v4s, coverFaceId? }`, each attach is `{ personId UUID, faceIds ≥1, coverFaceId? }`. Nested objects are transformed via `@Type` + `@ValidateNested`; the service (not the DTO) enforces the 5000-face cap and `coverFaceId ∈ item.faceIds`.
- `UpdatePersonDto implements UpdatePersonRequest`: required `name` string (≤80). Note the shared type declares `string | null`, but `@IsString()` requires an actual string, so a JSON `null` is rejected at the ValidationPipe.
- `CoverPersonDto`: required `faceId` UUID. Ownership is re-checked in the service, including that the face's `personId` equals the route person id (403 otherwise).
- `ReassignFacesDto implements Omit<ReassignFacesRequest, 'fromPersonId'>`: optional nullable `toPersonId` UUID and `faceIds: string[]` with `@ArrayMinSize(1)` + `@IsUUID('4', { each: true })`. `toPersonId: null` means "unassign these faces".
- `ListPersonsQueryDto`: `limit?` (Number, 1..1000, default 20), `offset?` (Number, ≥0). It is reused as the query type for `GET :id/assets` even though that route only reads `limit`/`offset`.

## Flow

- Global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` runs before the controller; `limit`/`offset` arrive as strings and are converted by `@Type(() => Number)`.
- `reassign` takes no person id from the path despite the `POST :id/reassign` route — the `:id` param is ignored by the service, and `toPersonId`/`faceIds` drive the move.
- `userId` fallbacks are gone: identity always comes from the verified JWT (`req.user.id`), including `apply-clusters`.

## Integration

- Consumed by `PersonsController` and `PersonsService`.
- `apply-clusters` is the worker's only write path into persons; the plan shape is duplicated as `CoreClient`'s `ApplyClustersPayload` in worker-service (wire types were deliberately not exported from `@photox/shared-types`).
- `UpdatePersonRequest` / `ReassignFacesRequest` wire contracts come from `@photox/shared-types`; `CreatePersonDto`, `CoverPersonDto`, `ApplyClustersDto`, `ListPersonsQueryDto` are local-only shapes.
- Swagger metadata feeds core's `/docs` / `/docs-json`.
