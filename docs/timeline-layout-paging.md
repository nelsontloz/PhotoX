# Timeline layout: month pages + browser cache (plan)

Item 18: `GET /assets/layout` returns the whole library (~55 B/asset, 5.5 MB at 100k) and is rebuilt
on every ETag miss (any upload, trash, favourite, edit), then sorted and packed on the main thread.

Target: page the layout per month, persist month windows in the browser, and after any change pull
only the windows whose content changed.

## Why paging alone is not enough

The web needs every month's items (`t,w,h`) before it can build the scroll track: bucket tops,
`totalHeight`, the scrollbar month map and the one-shot scroll restore all come from `buildBuckets`
over the full item list (`apps/web/src/lib/timelineLayout.ts`). Heights are width-dependent (greedy
`packRows` at the current container width), so the server cannot precompute them for every viewport
without duplicating that algorithm.

Accepted consequences:

- **Cold load still transfers the full dataset** — chunked into month windows, and then never again
  (no gzip from core; the reverse proxy owns transfer size). The reported symptom is a multi-second
  stall _after every change_, and the cache + per-window invalidation is what fixes it.
- A progressive track (months appear as they load) is rejected: it reintroduces the shift that
  `useTimelineLayout`'s ponytail comment and `TimelineGridSpace.spec` currently prevent.
  Server-computed heights per width is the upgrade path if cold load must shrink later; it means a
  second implementation of `packRows` and a request per resize — not now.

## API

Path policy in `open-routes.ts` is unchanged (both routes are authenticated).

### `GET /api/v1/assets/layout/months` (new)

```
?tz=Europe/Madrid&personId&favorite&albumId
→ { months: [{ key: '2024-03', from: '2024-02-29T23:00:00.000Z',
               to: '2024-03-31T22:00:00.000Z', count: 812, version: '812-1712...-0-0' }] }
```

- `tz` is an IANA zone (`Intl.DateTimeFormat().resolvedOptions().timeZone` on the client), validated
  with `new Intl.DateTimeFormat('en-US', { timeZone: tz })` → `400` on `RangeError`. Defaults to
  `UTC`. The browser groups days in local time, so the windows must be local calendar months too —
  UTC-month grouping would put boundary items in a window the client renders under another month and
  break version bookkeeping.
- Sorted `key` desc. Only windows with `count > 0` are returned: a window that newly gains assets
  appears as a new key, and one that empties disappears.
- One grouped query over `assets_layout_idx` (index-only scan,
  `date_trunc('month', COALESCE("takenAt","uploadedAt") AT TIME ZONE :tz)`), plus one grouped
  query for hidden-album membership **only when** the user has a hidden album
  (`SELECT 1 FROM albums WHERE "userId" = $1 AND "hiddenFromTimeline" LIMIT 1` first).
- `Cache-Control: private, no-store`, `Vary: Authorization` — this is the revalidation call.
- No ETag: the client never conditionally GETs it.

`version` per window, in this order, joined by `-`:

```
count - maxUpdatedAtMs - hiddenCount - hiddenMaxTouchedMs [- albumMaxAddedMs]
```

- `count`/`maxUpdatedAtMs`: the visible matching set in the window (same predicates as the page).
- `hiddenCount`/`hiddenMaxTouchedMs`: the hidden-album rows in the window
  (`COUNT(*)`, `MAX(GREATEST(al."updatedAt", aa."addedAt"))`), so hide/unhide and hidden-album
  membership changes move the version even though `assets.updatedAt` does not. `0-0` when the window
  has none, and skipped entirely for `albumId=` views (which bypass the hidden filter).
- `albumMaxAddedMs` (`albumId=` only): `MAX(aa."addedAt")` in that album's window, because
  membership changes never bump `assets.updatedAt`; removals already move `count`.

It covers: add, delete, trash/restore, any PATCH (dates, title, favourite), hidden-album toggle and
membership. It does **not** cover person clustering: `faces` has no `updatedAt`
(`apps/core/src/database/entities/face.entity.ts`), so `personId` views stay memory-only on the
client. Same hole the current filtered-ETag comment documents; do not pretend to solve it here.

### `GET /api/v1/assets/layout?from&to&offset&limit` (extend)

```
→ { from, to, version, total, items: [{t,w,h}], nextOffset: number | null }
```

- `from`/`to` are half-open UTC instants echoed from the index (never re-derived on the client), same
  predicates as today (`applyHiddenAlbumFilter` unless `albumId`, then `applyAssetFilters`) plus the
  range. `offset` default 0, `limit` default 2000, hard max 5000.
- `nextOffset` = `offset + items.length` while `< total`, else `null`. `version` is computed for the
  whole window once (not per page).
- Offset paging, not keyset: it needs no index change, and the worst case (a 100k import with no
  EXIF dates lands entirely in one window through `uploadedAt`) is a rare cold path.
- Concurrency: a page fetch that returns a different `version` than the first page of the same
  window means the month changed mid-walk — the client restarts that window once.
- **Legacy**: no `from`/`to` → exactly today's `{ items }` body and ETag path, unchanged. The e2e
  suite (`e2e/steps/albums/albums.steps.ts`) and the integration specs keep hitting it.
- Both `from` and `to` or neither → `400` (`@ValidateIf` pair or a class-level check).

Both params sets live in one `LayoutQueryDto` (`@IsUUID` person/album, `@IsBoolean` favourite,
`@IsISO8601` from/to, `@Type(() => Number)` offset/limit, `tz` regex). `forbidNonWhitelisted` is
global, so the DTO is the only place new params can be added.

Service signatures stay additive:

```ts
layout(userId, personId?, favorite?, albumId?, range?: { from: Date; to: Date; offset: number; limit: number })
layoutMonths(userId, personId?, favorite?, albumId?, tz?: string)
```

so existing positional callers and the timeline unit harness keep working.

### Compression

Out of scope by decision: no `compression` middleware in core.

## Web

### `apps/web/src/lib/layoutCache.ts` (new)

IndexedDB, no dependency. DB `photox-layout`, store `months`, key
`[userId, filterKey, monthKey]` → `{ from, to, count, version, items, savedAt }`.

- `userId` from `useAuthStore().user?.id` (persisted profile only, never tokens). Another account on
  the same browser gets its own records; no id → memory only.
- `filterKey` = `personId|favorite|albumId`. `personId` views pass no `userId` → memory only.
- API: `readMonths`, `writeMonth`, `pruneExcept`, all promise-wrapped with `try/catch` that falls
  back to an in-memory `Map` (jsdom has no IndexedDB, so this is also the test seam).
- Only `{t,w,h}` + window metadata is stored, ~5.5 MB at 100k. No eviction beyond `pruneExcept`
  (records whose window vanished from the latest index); the exact track needs every window.
- No logout purge: dims only, and user-namespaced.

### `useTimelineLayout` rewrite

```
index   = getAssetLayoutIndex({ tz, ...filters })
cached  = readMonths(index.months.map(m => m.key))
changed = months where !cached || cached.version !== m.version
fresh   = await pool(changed, 4, fetchWholeWindow)   // offset walk + version re-check
items   = cached ∪ fresh, concatenated in index order
layout  = buildBuckets(items, { containerWidth, rowHeight })   // unchanged
```

- Cold load: `1 + pages` requests. Warm load: 1 (the index) + 0.
- `loading` until the first complete item set; `layout.buckets` stays empty until then, so the grid's
  restore guard and `TimelinePage`'s error gate behave as today. Layout failure → page error state.
- `layoutItems` remains the concatenation of every window (desc) — `useTimelineNav` needs the whole
  filtered set for viewer prev/next.
- Resize: recompute only, never refetch.
- `timelineRefreshKey` bump: one in-flight re-index at a time; diff, refetch only mismatched
  windows, drop vanished ones.
- Persist per window as it lands only if its returned `version` still matches the index entry.

### Scroll anchoring on refresh

`TimelineGrid` only restores the remembered day once, so a window that grows _above_ the viewport
would move the day under the sticky header. Add one effect: on a layout rebuild after the initial
restore, read `dayAtContentY(prevLayout, scrollTop)`, then `dayContentY(nextLayout, day)` and adjust
`scrollTop` by the delta once. Skip when the anchor day is gone (trashed).

## Test plan

Core:

- integration (`apps/core/test/integration/assets-layout.spec.ts`, real Postgres): window grouping
  honours `tz` (an item at 23:30 local on the last day lands in that local month; a UTC default run
  differs); add / edit (`takenAt` move, width) / trash / restore / hidden-album toggle / add+remove
  into a hidden album each change exactly the affected window's version, and only that window's;
  `albumId` version moves on membership change; `from`/`to` bounds (start inclusive, end exclusive);
  `offset`/`limit` walk with `nextOffset`, `limit` 5000 cap; `from` without `to` → 400; bad `tz` →
  400; empty library → `months: []`; legacy no-param call still `{ items }` + ETag + 304.
- controller unit spec: legacy branch keeps ETag headers; window branch sets
  `Cache-Control: private, no-cache` + `Vary: Authorization` and no ETag; `layoutMonths` sets
  `no-store`.

Web:

- `useTimelineLayout`: warm load issues 1 index request and 0 page requests; a version bump refetches
  only that window; a new/window key added, a vanished key pruned; window page walk concatenates
  `nextOffset` pages once and restarts on a mid-walk version change; IDB failure falls back to memory;
  `personId` never hits IDB.
- `TimelineGrid` anchoring: a window above the viewport gaining assets keeps the sticky day fixed
  (extend `TimelineGridSpace.spec`).
- Existing `buildBuckets` / `TimelineScrollbar` / `TimelineGrid` specs pass untouched.

e2e: `06-albums/albums-hidden.feature` (legacy layout + ETag steps) and the timeline/scroll-restore
suites pass unchanged.

Budget to record in the PR (100k fixture): cold index bytes, warm-load request count, post-upload
request count, `EXPLAIN` of the grouped query (expect an index-only scan of `assets_layout_idx`;
add a functional month index only if it is not).

## Lanes / order

1. **Core + shared-types** (`apps/core/src/assets/**`, `packages/shared-types/src/index.ts`,
   `apps/core/test/integration/assets-layout.spec.ts`): index endpoint, window page, DTO, specs.
2. **Web** (`apps/web/src/**`): `layoutCache.ts`, `useTimelineLayout`, `api/assets.ts`,
   `TimelineGrid` anchoring, specs.
3. **Docs**: one line in `AGENTS.md` (API conventions).

Then: core `assets` specs + web specs, `pnpm verify`, PR.

## Explicitly not doing

- Server-side height/row computation per viewport (duplicate `packRows`, resize request storm).
- Progressive/augmenting scroll track (shift).
- Delta payloads, websockets or push invalidation — one cheap index call per change is enough.
- Merging the layout page into `useTimelineMonths`' asset fetch: the layout must be complete before
  the first render, the asset list is lazy; different lifetimes.
- Per-window ETag/conditional GET: the client cache already skips the request.
- Optimistic invalidation of the upload month: the index round-trip is ~1 KB, not worth a second
  source of truth.
