# packages/data-access/src/storage/

## Responsibility

`LocalStorageService` — the only blob I/O in PhotoX. It maps opaque `storageKey`s to files
under `STORAGE_DIR` on local disk and provides atomic writes plus stream reads. No S3/MinIO:
Docker mounts one `storage-data` volume at `/data/storage`, local dev uses
`./data/storage`.

## Design

`@Injectable()` class with no constructor state — every method resolves
`loadEnv().STORAGE_DIR` at use time.

- `buildKey(kind, userId, fileId, ext): string` — canonical layout:
  - `original` → `originals/<userId>/<fileId>.<ext>`
  - `thumbnail` → `derivatives/thumbnails/<userId>/<fileId>.<ext>`
  - `transcode` → `derivatives/transcodes/<userId>/<fileId>.<ext>`
    Leading dots in `ext` are stripped (`replace(/^\.+/, '')`).
- `pathFor(storageKey)` — resolves `storageKey` against `loadEnv().STORAGE_DIR` and rejects keys
  escaping that root (`Error: Invalid storage key`); it is the single containment guard every fs
  method routes through (a bare `join` would let `..`/absolute keys out).
- `ensureDir()` — `mkdir(STORAGE_DIR, { recursive: true })` for startup.
- `save(key, tmpPath)` — atomic publish: `mkdir -p` the destination directory, then
  `rename(tmpPath, \`${dest}.<uuid>.tmp\`)`; on `EXDEV`(tmp on another filesystem, e.g.
multer temp dir vs volume) it falls back to`copyFile`+ best-effort`unlink(tmpPath)`,
then `rename(tmp, dest)`. A reader never observes a partial file at `dest`.
- `createReadStream(key, range?)` — `fs.createReadStream` with optional `{start,end}` for
  HTTP Range/206 serving.
- `stat(key)` — `fs/promises.stat` for size/etag headers.
- `delete(key)` — `unlink`, swallowing `ENOENT` so cleanup is idempotent.

## Flow

Upload: core streams the request body to a tmp path, then calls
`save(buildKey('original', ...))`. Thumbnail/transcode jobs read the original via
`createReadStream`/`pathFor`, write a derivative tmp file, `save` it, and record a new
`FileRecord`. Deletion and orphan-cleanup jobs call `delete`; existence checks use `stat`.

## Integration

Provided by `apps/core/src/files/storage/storage.module.ts` (re-exported to core services)
and directly in `apps/worker-service/src/queue/queue.module.ts`; injected by the thumbnail,
video, metadata, face, cleanup, and cleanup-orphans processors plus core's user-files /
face-thumb / admin services. `save` is the only sanctioned writer, and `STORAGE_DIR`
resolution (workspace-root anchoring) comes from `@photox/shared-config`. Covered by
`local-storage.service.spec.ts` (the package's own Vitest project).
