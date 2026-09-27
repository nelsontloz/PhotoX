# apps/core/src/files/user/

## Responsibility

The upload and file-bytes surface for signed-in users: multipart upload (which also creates the `Asset` and fans out processing jobs), file metadata/list, Range-capable streaming, download, and delete. Routes: `api/v1/files` for collection ops and `api/v1/files/:fileId/...` for item ops.

## Design

- `UserFilesController` uses `@UseInterceptors(FileInterceptor('file', ...))` with multer `diskStorage` writing to `os.tmpdir()` under a random UUID filename, `limits.fileSize = 4 GiB`. The body carries optional `kind`, `title`, `description`, `takenAt` (`UploadFileBodyDto`).
- `UserFilesService.upload` orchestrates:
  1. `storeFile(userId, file, 'original', null)` — SHA-256 the temp file, dedupe per `(userId, checksumSha256, purpose)` (optionally `assetId`), `LocalStorageService.buildKey('original', ...)`, atomic save, `FileRecord` insert; temp file is always unlinked in `finally`; if the DB insert fails the stored object is deleted.
  2. kind resolution: explicit `kind` or MIME prefix (`image/*` → photo, `video/*` → video; otherwise 400).
  3. On dedupe hit (`created === false`) it looks up an existing asset by `fileId`; if found → 409 `{ existingAssetId, existingFileId }`.
  4. `AssetsService.create(...)` (fileId, kind, title, description, takenAt, mimeType, sizeBytes, originalName).
  5. Enqueue: `enqueueThumbnails` (jobId `thumb-<assetId>-<size>` for sm/md/lg/xl, 3 attempts exponential backoff — awaited), `process-metadata` and (photo) `process-faces`, or `enqueueVideo` (jobId `video-<assetId>`) for videos (fire-and-forget `void`).
- Ownership: `getOne`, `download`, `delete` compare `record.userId` to the request user and return 404 on mismatch (delete silently returns for missing/wrong-owner rows — idempotent 204).
- `stream(fileId, range?)` deliberately takes **no userId**: `GET /:fileId/stream` is a public capability URL (the open-route table matches exactly `GET /api/v1/files/:fileId/stream`), used for `<video>` playback. It stats the storage key and opens a ranged read stream.
- Range handling lives in the controller: invalid/unsatisfiable range → `416` with `Content-Range: bytes */<total>`; valid → `206` with `Content-Range`, `Content-Length`, `Accept-Ranges: bytes`; no header → `200` with full `Content-Length` + `Content-Disposition: attachment`. Stream errors destroy the response; response `close` destroys the read stream (no leaked fds).
- `GET /` lists only `purpose = 'original'` rows, optional MIME prefix (`LIKE 'prefix%'`), ordered `createdAt DESC`, paginated; inline response subset (no storageKey/checksum).

## Flow

- Browser: `POST /api/v1/files` (multipart) → file stored → asset created → response is the `AssetResponse`; jobs run asynchronously in worker-service against the same DB/volume.
- Playback: `GET api/v1/files/:fileId/stream` (open route) with or without `Range` → 200/206/416 as above.
- Download: `GET api/v1/files/:fileId/download` (JWT + owner) → stream with attachment filename.
- Cleanup: after the asset is purged (`DELETE api/v1/assets/trashed/:id` returns `{fileIds}`), the worker's `cleanup-asset` consumer deletes the storage objects; `DELETE api/v1/files/:fileId` is the direct per-file path.
- `GET api/v1/files` exposes uploaded originals for the file-manager view; derivative rows never appear in this list.

## Integration

- `UserFilesModule` imports `TypeOrmModule.forFeature([FileRecord])`, `StorageModule`, and `AssetsModule`; exports `UserFilesService`, which `SharesModule` reuses for public streaming.
- Queue contracts: `BullMqService.enqueueThumbnails/enqueueVideo` in `apps/core/src/queue/bullmq.service.ts`; consumers live in `apps/worker-service/src/queue`.
- Depends on `LocalStorageService` (shared with worker-service through the `storage-data` volume) and `toFileRecordResponse`/`parseRangeHeader` from the parent `files/` folder.
- Every route except `GET :fileId/stream` requires a Bearer JWT (`JwtAuthGuard`); uploads and Range/206/416 streams are handled directly, never buffered.
