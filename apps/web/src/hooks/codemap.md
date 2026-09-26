# apps/web/src/hooks/

## Responsibility

Reusable hooks that fetch/group data and drive the asset viewer. Hand-rolled data fetching on top of `src/api` (no react-query/SWR): each hook owns `loading`/`error`/data locally and exposes an explicit `refresh()`.

## Design

- `useAssetGroups(opts: { isTrashed?, favorite?, dateField?: 'takenAt'|'trashedAt' })` — loads ALL assets by paging `listAssets` at 50/request until `total`, then sorts by `takenAt ?? uploadedAt` (or `trashedAt`) descending and buckets by calendar day with `groupDateSortKey`/`groupDateLabel`. `fetchIdRef` guards against stale responses when refetches overlap. Subscribes to `useAppStore.timelineRefreshKey`, so an upload batch re-fetches automatically. Used by `pages/index`, `favorites`, `trash` and `TimelineGrid`.
- `useAlbums()` — loads the first 1000 albums once; `create`/`update`/`remove` call the API then re-fetch the whole list; `remove` asks `window.confirm` ("Assets in it will not be deleted"). Returns `{ albums, total, loading, error, refresh, create, update, remove }`.
- `useAlbumAssets(albumId, pageSize = 60)` — loads the first page of an album's assets; `addAssets`/`removeAsset` mutate then re-fetch; `removeAsset` confirms via `window.confirm`. No pagination beyond page 1 (ponytail-sized for personal libraries).
- `useAssetNavigation({ assets, onAfterAction })` — no fetching: the `?asset=<id>` search param is the single source of truth for the open viewer. Derives `selected` by id lookup (ignores stale ids not in the given list) and `hasPrev`/`hasNext` by index. `open`/`goPrev`/`goNext` rewrite the param; `close` clears it. `trash`/`restore`/`permanentlyDelete`/`toggleFavorite` call the assets API, close the viewer and `await onAfterAction()` (typically a `refresh`); destructive ones `window.confirm` first and `window.alert` on failure. Covered by `useAssetNavigation.spec.tsx` (MemoryRouter).
- `useLongPress(callback, ms = 500)` — touch-only long-press: arms a timer on `pointerdown` only when `pointerType === 'touch'`, clears on up/leave/cancel, and exposes `justLongPressedRef` so the following click can be suppressed; `onContextMenu` prevents the native menu while armed. Used by `GalleryItem` for multi-select.
- Error convention across hooks: `(err as Error).message ?? '<fallback>'` into local `error`; mutations use native `confirm`/`alert`, not toast infrastructure.

## Flow

1. Mount/param change → hook effect → `src/api` call(s) → local state (`loading` → data / `error`).
2. Mutations call the API then `refresh()` — no optimistic updates, no client cache; the returned `refresh` is also passed as `onAfterAction` to `useAssetNavigation`.
3. Timeline hooks additionally re-fetch when `useAppStore.timelineRefreshKey` changes; `useAssetNavigation` reacts only to URL changes.

## Integration

- Talks to `src/api/assets.ts` and `src/api/albums.ts`; formats dates via `src/lib/dateFormat`.
- `pages/*` compose these hooks; `AssetViewer` receives `selected` plus nav/action callbacks; `TimelineGrid` types against `AssetGroup`.
- `useAppStore` is the only store these hooks touch directly; auth is enforced upstream by `RequireAuth`, not by the hooks.
- Tests: `useAssetNavigation.spec.tsx` only.
