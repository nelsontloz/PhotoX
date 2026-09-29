# apps/core/src/files/user/dto/

## Responsibility

Validation shapes for the user file endpoints: the multipart upload body, the worker file-registration body, the file-list query, and the list response type.

## Design

- `UploadFileBodyDto`: optional `kind` (`'photo' | 'video'`), optional `title` (≤255), `description` (≤2000), `takenAt` (ISO date string). The actual file part is handled by multer, not by this DTO — only the multipart form fields are validated.
- `RegisterFileBodyDto` (worker-only `POST /register`): `id` UUID, `kind` (`original | thumbnail | transcode`), `ext` (1–8 lowercase alphanumerics), `checksumSha256` (64 hex), `originalName`, `mimeType`, `sizeBytes` (≥0), optional `assetId` UUID. Deliberately no `storageKey` — core recomputes it to stop cross-user path injection.
- `ListFilesQueryDto`: `limit?` (`@Type(() => Number)`, 1..100, default 20 in the service), `offset?` (≥0), `mimeType?` (string, used as a `LIKE 'prefix%'` filter).
- `FileListResponseDto implements FileListResponse` (from `@photox/shared-types`): `items`, `total`, `limit`, `offset` — exists for Swagger typing; the service builds the shape inline with its own item projection (id, userId, originalName, mimeType, sizeBytes, createdAt).
- No DTO exists for stream/download/delete parameters (raw path params only).
- `fileId` is a path parameter on every item route; the only validated request payload for uploads is the multipart form body, never the file part itself (multer enforces the 4 GiB cap).

## Flow

- `POST api/v1/files` multipart: multer parses the file part and puts the text fields into `@Body()`; the global `ValidationPipe` validates/transforms the DTO class, rejecting unknown fields (`forbidNonWhitelisted`).
- `POST api/v1/files/register`: `kind` is required and drives `purpose`; unknown/extra fields (e.g. a smuggled `storageKey`) are rejected by the same pipe.
- `kind` is optional because it can be inferred from the MIME type server-side; when present it wins.
- `GET api/v1/files` query strings are transformed to numbers by `@Type` before `Min`/`Max` validation; `mimeType` is passed unescaped into a QueryBuilder `LIKE` parameter placeholder.

## Integration

- Consumed by `UserFilesController` (`api/v1/files`).
- `UploadFileBodyDto` fields are forwarded into `UserFilesService.upload` as `UploadMeta` and then into `AssetsService.create`.
- `FileListResponse` wire type comes from `@photox/shared-types`; the entity comes from `../../../../database/entities`.
