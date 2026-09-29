# apps/web/src/pages/

## Responsibility

File-based route modules for the web SPA. Each `index.tsx` (or `[param].tsx`) default-exports a page component; `App.tsx` mounts them via `useRoutes(routes)` from `vite-plugin-pages` (`virtual:generated-pages-react`). Pages own data fetching, viewer selection state, and the guard/shell wrapper for their route.

## Design

- Routing table (generated from filenames):
  - `/` → `index.tsx` — Timeline (guarded).
  - `/albums` → `albums/index.tsx`, `/albums/:id` → `albums/[id].tsx` (guarded).
  - `/favorites`, `/people`, `/people/:id`, `/places`, `/shared`, `/trash`, `/admin` (guarded).
  - `/login`, `/register` → public auth pages.
  - `/share/:token` → public share viewer.
- No shared layout route: protected pages repeat `<RequireAuth><AppShell>…</AppShell></RequireAuth>`. Admin nests `<RequireAuth><RequireAdmin>`. `places/index.tsx` hand-rolls `AppHeader`/`Sidebar`/`UploadNotification` instead of `AppShell` because the map fills the viewport without scroll.
- Common conventions: loading spinner → error block with Retry → empty state; `React.lazy` for `AssetViewer` on timeline/albums/people (eager on favorites/trash); viewer selection via `useAssetNavigation` (`?asset=<id>`); `window.confirm`/`window.prompt` for destructive and rename flows; Tailwind dark-first classes. Exception — the timeline's gate is layout-driven: the layout endpoint is the single structural source, so its failure (first load or refresh) lands on the error state (Reload retries, no partial-track fallback — deliberate, `ponytail:` noted in `pages/index.tsx`); spinner only while the layout's first load is in flight; layout with buckets → grid immediately (months fill in behind skeletons, no asset-loading gate); layout loaded and zero buckets → empty state.
- Data layer is mixed by design: extracted hooks (`useTimelineMonths`, `useTimelineLayout`, `useAssetGroups` (favorites/trash fetch-all), `useAlbums`, `useAlbumAssets`, `useAssetNavigation`) for timeline/album flows, inline `useEffect` + `api/*` for people, places, shared, admin. Small pages stayed local instead of growing generic hooks. The timeline page wires the partial-data edges: `hasBeyond`/`resolveBeyond` (layout ends → adjacent month fetch) and `resolveMissing` (deep-linked asset fetched directly) into `useAssetNavigation`, and its `refresh` is just `bumpTimelineRefresh()` — one signal refetches layout and invalidates visible months.
- Auth pages (`login`, `register`) redirect already-authenticated users with `<Navigate to="/" replace>`; `share/[token]` is unauthenticated and reads the public endpoint.

## Flow

Route mount → fetch through `api/client` (axios, baseURL `/api`, Bearer from `auth-store`, 401 → refresh + single retry) → render grid/list → selecting an asset writes `?asset=<id>` → `AssetViewer` overlay → actions call `api/assets` etc. and refresh the page's source list. Uploads triggered from any shell bump `app-store.timelineRefreshKey`, refetching timeline-family pages.

## Integration

Consumes `components/*` (shell, guards, grids, dialogs, viewer), `hooks/*`, `store/{auth,app,upload,thumb}-store`, and `api/{assets,albums,persons,shares,admin}`; all traffic goes to core at `/api` (the `/api/share/*` prefix is public in the open-route table). `places` additionally pulls in `leaflet`. Types come from `@photox/shared-types`.
