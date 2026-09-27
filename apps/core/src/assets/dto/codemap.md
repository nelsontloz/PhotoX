# apps/core/src/assets/dto/

## Responsibility

Validation shapes for the asset endpoints: create-from-file, user edits, the worker metadata patch, bulk trash, thumbnail registration, and the rich list filter query.

## Design

- `CreateAssetDto`: optional `userId?` (UUID fallback), required `fileId` (UUID) and `kind` (`'photo' | 'video'`), optional `title` (≤255), `description` (≤2000), `takenAt` (ISO date string), `mimeType`, `sizeBytes` (≥0), `originalName`. The service converts `takenAt` to `Date`.
- `UpdateAssetDto`: the user-editable subset only — optional `userId?`, `title`, `description`, `takenAt`, `favorite` (boolean). Status/EXIF/transcode fields are deliberately absent.
- `ListAssetsQueryDto`: filters `kind`, `mimeType` (prefix), `fromDate`/`toDate` (ISO), `favorite`, `metadataStatus` (`pending|ready|failed`), `hasFaces`, `hasLocations`, plus `userId?`, `limit` (1..100), `offset` (≥0). Booleans use `@Transform` for `true`/`'true'` because query params are strings.
- `TrashAssetsDto`: `assetIds: string[]` with `@IsString({ each: true })` and `@MinLength(1, { each: true })`; no UUID validation and no max size.
- `UpdateMetadataDto`: the worker callback surface — `status` (`pending|ready|failed`, sets `metadataExtractedAt`), `takenAt` (`@Type(() => Date)` + `@IsDate`), `mimeType`, `sizeBytes`, `originalName`, `width`, `height`, `durationSeconds`, `fps`, `codec`, `hasAudio`, `cameraMake/Model`, `lensModel`, `orientation`, `iso`, `fNumber`, `exposureTime`, `focalLength`, GPS (`latitude/longitude/altitude`), raw `metadata` (jsonb `Record<string, unknown>`), `transcodeStatus`, `thumbnailStatus`, nullable `transcodeFileId`, `faceStatus`, `faceCount` (numeric int ≥0).
- `RegisterThumbnailDto`: `size` (≤50 chars), `fileId` (UUID), `width`/`height` (int ≥1), `bytes` (int ≥0) — the upsert key is `assetId+size`, the payload describes the derivative.

## Flow

- Global `ValidationPipe` in core `main.ts` applies `whitelist + forbidNonWhitelisted + transform`, so unknown properties are rejected and numeric/boolean/date strings are coerced before reaching controllers.
- `ListAssetsQueryDto.metadataStatus` is validated to an enum but not transformed; values are used directly in the QueryBuilder.
- `UpdateMetadataDto.status` is the only field that also mutates `metadataExtractedAt`, keeping "when did extraction finish" tied to the status transition.

## Integration

- Consumed only by `AssetsController`/`AssetsService` and `ThumbnailsController`/`ThumbnailsService` (same folder).
- `CreateAssetDto` is also constructed programmatically by `UserFilesService.upload` (not just parsed from HTTP), so all required fields are pre-filled there.
- The metadata DTO defines the de-facto contract between worker-service processors (`metadata`, `video`, `thumbnail`, `face`) and core.
