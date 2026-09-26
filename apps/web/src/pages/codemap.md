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
- Common conventions: loading spinner → error block with Retry → empty state; `React.lazy` for `AssetViewer` on timeline/albums/people (eager on favorites/trash); viewer selection via `useAssetNavigation` (`?asset=<id>`); `window.confirm`/`window.prompt` for destructive and rename flows; Tailwind dark-first classes.
- Data layer is mixed by design: extracted hooks (`useAssetGroups`, `useAlbums`, `useAlbumAssets`, `useAssetNavigation`) for timeline/album flows, inline `useEffect` + `api/*` for people, places, shared, admin. Small pages stayed local instead of growing generic hooks.
- Auth pages (`login`, `register`) redirect already-authenticated users with `<Navigate to="/" replace>`; `share/[token]` is unauthenticated and reads the public endpoint.

## Flow

Route mount → fetch through `api/client` (axios, baseURL `/api`, Bearer from `auth-store`, 401 → refresh + single retry) → render grid/list → selecting an asset writes `?asset=<id>` → `AssetViewer` overlay → actions call `api/assets` etc. and refresh the page's source list. Uploads triggered from any shell bump `app-store.timelineRefreshKey`, refetching timeline-family pages.

## Integration

Consumes `components/*` (shell, guards, grids, dialogs, viewer), `hooks/*`, `store/{auth,app,upload,thumb}-store`, and `api/{assets,albums,persons,shares,admin}`; all traffic goes to core at `/api` (the `/api/share/*` prefix is public in the open-route table). `places` additionally pulls in `leaflet`. Types come from `@photox/shared-types`.
