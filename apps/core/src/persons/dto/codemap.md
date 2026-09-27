# apps/core/src/persons/dto/

## Responsibility

Request shapes for the `api/v1/persons` endpoints: create, rename, cover selection, batch face reassignment, and the pagination query reused by list and per-person assets.

## Design

- `CreatePersonDto`: optional `userId?` (UUID fallback) and required `clusterLabel` string (≤200). `name` is intentionally absent — new persons are unnamed until renamed.
- `UpdatePersonDto implements UpdatePersonRequest`: required `name` string (≤80). Note the shared type declares `string | null`, but `@IsString()` requires an actual string, so a JSON `null` is rejected at the ValidationPipe.
- `CoverPersonDto`: optional `userId?` (UUID fallback) and required `faceId` UUID. Ownership is re-checked in the service, including that the face's `personId` equals the route person id (403 otherwise).
- `ReassignFacesDto implements Omit<ReassignFacesRequest, 'fromPersonId'>`: optional nullable `toPersonId` UUID and `faceIds: string[]` with `@ArrayMinSize(1)` + `@IsUUID('4', { each: true })`. `toPersonId: null` means "unassign these faces".
- `ListPersonsQueryDto`: optional `userId?` (UUID), `limit?` (Number, 1..1000, default 20), `offset?` (Number, ≥0). It is reused as the query type for `GET :id/assets` even though that route only reads `limit`/`offset`.

## Flow

- Global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` runs before the controller; `limit`/`offset` arrive as strings and are converted by `@Type(() => Number)`.
- `reassign` takes no person id from the path despite the `POST :id/reassign` route — the `:id` param is ignored by the service, and `toPersonId`/`faceIds` drive the move.
- `userId` fallbacks are inert for browser traffic (identity headers win) and exist for worker/internal callers.

## Integration

- Consumed by `PersonsController` and `PersonsService`.
- `UpdatePersonRequest` / `ReassignFacesRequest` wire contracts come from `@photox/shared-types`; `CreatePersonDto`, `CoverPersonDto`, `ListPersonsQueryDto` are local-only shapes.
- Swagger metadata feeds core's `/docs` / `/docs-json`.
