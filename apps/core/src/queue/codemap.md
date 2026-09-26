# apps/core/src/queue/

## Responsibility

The core app's BullMQ **publisher**: a global service that owns the Redis connection and hands jobs to worker-service consumers. Core never processes jobs.

## Design

`BullMqModule` is `@Global()` and exports `BullMqService`, so every feature module can inject the publisher without importing it.

`BullMqService implements OnModuleInit, OnModuleDestroy`:

- `onModuleInit` creates one shared `ioredis` connection from `ConfigService` (`REDIS_HOST`/`REDIS_PORT`, defaults `localhost`/`6379`) with `maxRetriesPerRequest: null` (required by BullMQ).
- `getQueue(name)` lazily creates and caches one `Queue` per name in a `Map`.
- `enqueue(queueName, jobName, data, opts)` — generic surface with options `{ jobId?, attempts?, backoff?, removeOnFail? }`. Errors (Redis down) are caught and `Logger.error`-ed: **fire-and-forget by contract**, callers use `void` and an HTTP request never fails because enqueueing failed.
- `enqueueThumbnails(assetId, fileId, userId, prefix = 'thumb')` fans out 4 `process-thumbnail` jobs for sizes `sm/md/lg/xl`, each `jobId: '<prefix>-<assetId>-<size>'`, attempts 3, exponential backoff, `removeOnFail: true`.
- `enqueueVideo(assetId, fileId, userId, { reprocess? })` adds one `process-video` job, `jobId: 'video-<assetId>'` or `'video-reprocess-<assetId>'`, attempts 3, exponential backoff.
- `onModuleDestroy` closes all queues then quits the connection.

Known core callers: `files/user/user-files.service.ts` (thumbnails, `process-metadata`, `process-faces` for photos, `enqueueVideo` for videos), `persons/persons.controller.ts` (`process-faces-cluster`), `admin/admin-maintenance.controller.ts` (`cleanup-orphans`, thumbnail reprocess with prefix `thumb-reprocess`).

## Flow

Upload/API action → `enqueue*` → Redis queue → worker-service consumers (`process-thumbnail`, `process-video`, `process-metadata`, `process-faces`, `process-faces-cluster`, `cleanup-orphans`, `cleanup-asset`). Dedup is by `jobId`, so replaying the same upload/reprocess path is a no-op while a matching job is retained.

## Integration

- Queue names and payload shapes (`{ assetId, fileId, userId, size? }` etc.) must match `apps/worker-service/src/queue/*.processor.ts`; the seven consumer names are the contract listed in AGENTS.md.
- `cleanup-asset` (worker `cleanup.processor.ts`, payload `{ fileId }`, deletes the storage blob + `FileRecord`) has no core caller today — reachable through the generic `enqueue`.
- Payloads are validated by consumer-side extraction, not by DTOs; publishers pass plain objects.
