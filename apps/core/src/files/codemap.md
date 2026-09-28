# apps/core/src/files/

## Responsibility

Shared file primitives used by the file HTTP surface: the wire DTO, the entity→wire mapper, and Range-header parsing. The actual endpoints live in the `user/`, `admin/`, and `storage/` subfolders; this folder has no controller, service, or module.

## Design

- `FileRecordDto implements FileRecord` (from `@photox/shared-types`): `id`, `userId`, `storageKey`, `originalName`, `mimeType`, `sizeBytes`, `checksumSha256`, `purpose: 'original' | 'transcode'`, nullable `assetId`, ISO `createdAt`. Used as the Swagger response type for `GET api/v1/files/:fileId`.
- `file-record.mapper.ts` exports `toFileRecordResponse(record: FileRecord)` — the single entity→wire mapper, shared so the API shape cannot drift from `FileRecordDto`; it converts `createdAt` to ISO and `sizeBytes` (a `bigint` column, returned as a string by the pg driver) to a JS number.
- `streaming.util.ts` exports `RANGE_RE = /^bytes=(\d+)-(\d*)$/` and `parseRangeHeader(rangeHeader, totalSize)`. It supports a single byte range only (`bytes=start-` and `bytes=start-end`); it returns `null` for malformed input or `start >= totalSize` (caller responds 416 with `Content-Range: bytes */<total>`), clamps `end` to `totalSize - 1`, and treats `end < start` as "to end of file".
- Multi-range (`bytes=0-1,3-4`) or non-`bytes` units never match `RANGE_RE` and therefore become 416s; suffix ranges (`bytes=-500`) are unsupported.
- The root deliberately has no `FilesModule`; each subfolder owns its own module and imports `StorageModule` where disk access is needed.

## Flow

- Upload/stream/download requests flow through `user/user-files.controller.ts`; `parseRangeHeader` runs there and in `shares/public-shares.controller.ts` before `UserFilesService.stream`.
- Read responses from `GET :fileId` and `POST /files/register` are produced by `toFileRecordResponse`; list responses build their own inline subset (id, userId, originalName, mimeType, sizeBytes, createdAt) and therefore omit `storageKey`/`checksumSha256`.

## Integration

- `FileRecord` entity lives in `packages/data-access` (`files` table, unique-ish `(userId, checksumSha256)` index and `(userId, purpose, createdAt)` index; `purpose` defaults to `'original'`).
- Physical bytes are laid out by `LocalStorageService.buildKey`: `originals/<userId>/<fileId>.<ext>`, `derivatives/thumbnails/<userId>/<fileId>.<ext>`, `derivatives/transcodes/<userId>/<fileId>.<ext>` under `STORAGE_DIR`.
- Worker-service no longer writes these rows: it saves bytes to disk then registers them through core `POST api/v1/files/register` (thumbnails as `purpose: 'original'` with a `derivatives/thumbnails/...` key; videos as `purpose: 'transcode'`), and core recomputes the `storageKey` server-side. The `admin/` subfolder adds the admin `DELETE /api/v1/admin/files/:fileId` cleanup endpoint.
- `FileRecordDto`/mapper are consumed by `files/user`; `parseRangeHeader` is consumed by `files/user` and `shares`.
