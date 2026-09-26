# apps/web/src/lib/

## Responsibility

Framework-free helpers: the client-side upload queue, optimistic thumbnail generation, date grouping and value formatting. No React, no JSX.

## Design

- `upload.ts` — the upload pipeline.
  - `enqueueFiles(files, { onComplete })` pushes items into `useUploadStore` (the persisted queue UI), keeps real `File` objects in a module-level `filesRef: Map<itemId, File>` (Files can't be persisted), then starts `processQueue` over only the newly added ids.
  - `processQueue` runs a fixed worker pool of `MAX_CONCURRENT = 3` over the id list; each worker skips items that aren't `queued` (stale/reloaded entries don't re-upload), marks `uploading`, generates the optimistic thumb, calls `uploadFile`, marks `done`.
  - Optimistic thumb: `makeThumbnail(file)` blob → `URL.createObjectURL` → stored in `useThumbStore` (keyed by upload item id, for the `AssetThumb` fast path) and in `item.localThumbUrl`; undecodable inputs (e.g. video) are skipped silently.
  - HTTP 409 (duplicate file) is treated as success: item `done` with the server's `existingAssetId`/`existingFileId` instead of an error.
  - Failures set `status: 'error'` + message; retry is manual (re-drop/re-pick). When the whole batch settles it bumps `useAppStore.timelineRefreshKey` and calls `onComplete`.
  - `upload.spec.ts` verifies the pool keeps processing after 409s.
- `clientThumbnail.ts` — `makeThumbnail(file, maxSide = 256)`: `image/*` only; loads via `createObjectURL` + `Image`, draws scaled into a canvas (never upscales), exports WebP quality 0.8; returns `null` on any failure and always revokes its own object URLs. Deliberately lazy preview for files that aren't on the server yet.
- `dateFormat.ts` — Intl-based `formatShortDate` ("Monday, Jan 5"), `formatMonthYear` ("January 2025"), `groupDateLabel` ("Today" / "Yesterday" / short date within 6 days / else month-year) and `groupDateSortKey` (`YYYY-MM-DD`, local time) used to bucket the timeline.
- `format.ts` — `formatDuration(seconds)` → `h:mm:ss` or `m:ss`, null-safe (null/NaN/negative → null); `formatBytes(bytes)` → `B/KB/MB/GB/TB` with adaptive decimals, null for ≤ 0.

## Flow

Upload: pick/drop (`UploadButton`/`DropZone`) → `enqueueFiles` → store rows appear (`UploadNotification`) → ≤ 3 concurrent: local thumb first, then `POST /api/v1/files` with progress → item `done` (or 409-as-done, or `error`) → timeline refresh signal.

Display: `AssetThumb` first checks `thumb-store` (assets uploaded this session) before fetching `/v1/assets/:id/thumbnails` + blob download; viewer/pages format metadata with `format.ts`/`dateFormat.ts`.

## Integration

- `upload.ts` ↔ `src/api/assets.uploadFile`, `src/store/{upload,thumb,app}-store`, `./clientThumbnail`.
- `clientThumbnail` has no other dependencies — used only by the upload pipeline.
- `dateFormat` is consumed by `useAssetGroups` and grouping UI; `format` by upload list, metadata panel and viewer.
- Tests: `upload.spec.ts` (Vitest, mocked API + thumbnail).
