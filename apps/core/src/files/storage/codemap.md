# apps/core/src/files/storage/

## Responsibility

DI wiring for local-disk storage. `StorageModule` provides and exports `LocalStorageService` from `@photox/data-access`; there is no code in this folder beyond the module definition.

## Design

- `StorageModule` is a tiny pass-through module: `providers: [LocalStorageService]`, `exports: [LocalStorageService]`. Every consumer (core `files/user`, `faces`, shares) imports it so there is one provider instance per Nest context.
- `LocalStorageService` anchors all paths at `loadEnv().STORAGE_DIR` (default `./data/storage`, resolved at workspace root; the compose volume is `/data/storage`). Worker-service constructs its own instance of the same class against the same volume.
- Key layout (`buildKey(kind, userId, fileId, ext)`):
  - `originals/<userId>/<fileId>.<ext>`
  - `derivatives/thumbnails/<userId>/<fileId>.<ext>`
  - `derivatives/transcodes/<userId>/<fileId>.<ext>`
    The first path segment doubles as the `kind`.
- `save(key, tmpPath)` is atomic: `mkdir -p` destination dir, `rename(tmp → dest.uuid.tmp)`, then `rename(tmp → dest)`; on `EXDEV` (tmp on a different filesystem, e.g. container `/tmp` vs volume) it falls back to `copyFile` + unlink of the source. Multer writes uploads into `os.tmpdir()`, so the EXDEV path is a real laptop/container case.
- `createReadStream(key, range)` wraps `fs.createReadStream` with optional `{start,end}` for HTTP Range streaming; `stat(key)` supports `Content-Length`/416 decisions; `delete(key)` swallows `ENOENT` (idempotent) but rethrows other errors.
- `ensureDir()` exists but is not called by core consumers.

## Flow

- Upload: multer temp file → `UserFilesService.storeFile` → `storage.save(storageKey, tempPath)` → temp unlinked in `finally` regardless of outcome.
- Playback/download: `UserFilesService.stream` → `storage.stat` + `storage.createReadStream(range?)` → piped to the Express response.
- Faces: `FaceThumbService` reads the original bytes with `readFile(storage.pathFor(storageKey))`, then crops in-memory with sharp.
- Cleanup: `storage.delete(storageKey)` called by `UserFilesService.delete` and by worker-service cleanup processors (which read the storage key from `FileRecord`).

## Integration

- Imported by `apps/core/src/files/user/user-files.module.ts` and `apps/core/src/faces/faces.module.ts`; `SharesModule` gets stream access indirectly via `UserFilesModule`.
- `STORAGE_DIR` is the shared contract between core, worker-service, and the compose `storage-data` volume; no presigned URLs, no object store.
- Orphan bytes (no DB row) are found by the `cleanup-orphans` job; this module only provides key↔path helpers.
