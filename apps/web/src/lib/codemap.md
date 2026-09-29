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
- `dateFormat.ts` — Intl-based `formatShortDate` ("Monday, Jan 5"), `groupDateLabel` ("Today" / "Yesterday" / short date within 6 days / else "Dec 15, 2025") and `groupDateSortKey` (`YYYY-MM-DD`, local time) used to bucket the timeline. Labels are day-granular to match the day-granular sort key (a month-year fallback repeated one header per day). `groupDateLabelFromSortKey` is the inverse: labels a bare `YYYY-MM-DD` key as its LOCAL day (the bare string would parse as UTC) by constructing the date and reusing `groupDateLabel` — used for layout-only days whose assets haven't loaded yet. Plus the timeline's month-window helpers: `effectiveAssetDate(a)` (`takenAt ?? uploadedAt`, the client twin of the backend's COALESCE), `monthKeyOf(dateStr)` (`groupDateSortKey(...).slice(0, 7)` — the local YYYY-MM fetch unit) and `monthRange(monthKey)` → `{ dateFrom, dateTo }` half-open ISO instants built from local `Date` components (never a `…T00:00:00Z` string — DST-safe, and the month in the header is the month fetched); malformed keys throw.
- `timelineLayout.ts` — pure fixed-row timeline math (no DOM, no React), the source of truth for reserving full scroll space before thumbnails load. `packRows(items, { containerWidth, rowHeight })` greedy-packs natural widths (`rowHeight × w/h`, null dims → 1:1; `containerWidth <= 0` → 1 row) exactly like the flex-wrap grid; `buildBuckets(items, opts)` sorts desc by `t`, groups local days via `groupDateSortKey` into `YYYY-MM` buckets, and returns `{ buckets, totalHeight, dayIndex }`. Per-day height = `65 + rows × (rowHeight + 4) − 4`; bucket `height` sums its days with 40px between adjacent days, bucket `top` accumulates `prev.top + prev.height + 40`, and `totalHeight` = last `top` + last `height`. Each `days[]` entry carries its `items` (the day's `{ t, w, h }` list) so `TimelineGrid` can render packing-identical skeleton tiles before a month is fetched. `dayIndex` (day sortKey → `{ bucketKey, height, rows }`) is exposed for lookups. Constants: header block 65, row gap 4, section margin 40.
- `format.ts` — `formatDuration(seconds)` → `h:mm:ss` or `m:ss`, null-safe (null/NaN/negative → null); `formatBytes(bytes)` → `B/KB/MB/GB/TB` with adaptive decimals, null for ≤ 0.

## Flow

Upload: pick/drop (`UploadButton`/`DropZone`) → `enqueueFiles` → store rows appear (`UploadNotification`) → ≤ 3 concurrent: local thumb first, then `POST /api/v1/files` with progress → item `done` (or 409-as-done, or `error`) → timeline refresh signal.

Display: `AssetThumb` first checks `thumb-store` (assets uploaded this session) before downloading the `asset.thumbnails` blob embedded in list/getOne responses; viewer/pages format metadata with `format.ts`/`dateFormat.ts`.

## Integration

- `upload.ts` ↔ `src/api/assets.uploadFile`, `src/store/{upload,thumb,app}-store`, `./clientThumbnail`.
- `clientThumbnail` has no other dependencies — used only by the upload pipeline.
- `dateFormat` is consumed by `useAssetGroups`, `useTimelineMonths` (`monthRange`/`effectiveAssetDate`), `useAssetNavigation` (`monthKeyOf` for boundary steps) and grouping UI; `format` by upload list, metadata panel and viewer.
- Tests: `upload.spec.ts` (Vitest, mocked API + thumbnail), `timelineLayout.spec.ts` (exact heights/tops from the browser-verified formulas), `dateFormat.spec.ts` (sort-key label round-trip across timezones).
