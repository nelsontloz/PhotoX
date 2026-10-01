# apps/core/src/faces/dto/

## Responsibility

Validation shapes for face registration, assignment, and the box/embedding output types shared between face endpoints.

## Design

- `FaceBoxResponseDto`: `x`, `y`, `w`, `h` numbers, each `@Min(0)`; implements the box half of `FaceDto`. Used both as output (Swagger) and as a nested validation target by `DetectedFaceDto`.
- `FaceResponseDto`: `id`, `assetId`, `box` (`FaceBoxResponseDto`), `confidence`, nullable `personId`; `implements FaceDto` from `@photox/shared-types`.
- `DetectedFaceDto implements DetectedFaceInput`: required nested `box` (`@ValidateNested` + `@Type`), `confidence` (`@IsNumber`), and `embedding` as `number[]` with `@ArrayMinSize(512)` + `@ArrayMaxSize(512)` + `@IsNumber({}, { each: true })` — the exact `FACE_EMBEDDING_DIM` is enforced at the HTTP boundary.
- `RegisterFacesDto implements RegisterFacesRequestDto`: `faces: DetectedFaceDto[]` (nested validation) plus a **required** `userId` UUID and an optional `detector` (`@IsIn(FACE_DETECTOR_KINDS)`) recorded as `Face.detector` provenance. The array may be empty (no faces found) — the service handles that as a valid no-op and the worker patches `faceStatus=ready, faceCount=0`.
- `AssignPersonDto`: required `userId` UUID (fallback; `req.user.id` wins) and optional nullable `personId` UUID — omitting/null unassigns the face.
- There is no separate DTO for `FacesQueryController.list`; it reads raw `userId`/`includeEmbeddings`/`excludeTrashed` query strings.

## Flow

- Global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` applies; `embedding` arrays shorter/longer than 512 are rejected with 400 before any DB work.
- `FaceBoxResponseDto` doubles as the request nested type because class-validator cannot validate plain object literals without a class.
- `RegisterFacesRequestDto.userId` being required means worker/service callers always supply it; browser traffic hits the route with a Bearer token and the controller prefers `req.user.id` anyway.

## Integration

- Consumed by `FacesController` (`POST/DELETE api/v1/assets/:id/faces`), `FacesQueryController` (`GET api/v1/faces`, `PATCH api/v1/faces/:id/person`), and `FacesService` (`registerFaces`, `deleteForAsset`, `assignPerson`).
- `FaceDto` / `DetectedFaceInput` / `RegisterFacesRequestDto` wire contracts live in `@photox/shared-types`.
- Swagger schemas surface through core's `/docs` / `/docs-json`.
