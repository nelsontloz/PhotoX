# apps/web/src/pages/places/

## Responsibility

`/places` — a full-viewport Leaflet + OpenStreetMap map plotting every geotagged asset (`hasLocations: true`), with date/video popups and auto-fit bounds.

## Design

- Fetches all geotagged assets eagerly by paging `listAssets({hasLocations: true, limit: 100, offset})` until `total` is reached (no incremental map loading; `ponytail`-style simplicity for personal libraries).
- Map setup lives in a second effect that only runs when assets are loaded: creates `L.map` (zoom control moved bottom-right), OSM tile layer, a single shared `L.DivIcon` blue-dot marker (avoids Leaflet's default icon asset resolution issues under Vite), one marker per asset with a popup built from `formatShortDate` and a "Video" tag, then `fitBounds` with padding. Cleanup calls `map.remove()`.
- Deliberately does not use `AppShell`: the map must fill the viewport with `overflow-hidden`, so the page manually composes `AppHeader` + `Sidebar` + `UploadNotification` inside a flex column, then renders the map container in an un-padded `<main>`.
- Loading / error+`window.location.reload()` / "no photos with location data" empty state replace the map; assets missing coordinates are impossible here by the API filter.
- The marker `DivIcon` is defined once at module scope, avoiding Leaflet's default-icon asset resolution under Vite.
- Popups show the capture date (`takenAt ?? uploadedAt`, via `formatShortDate`) and a "Video" label for `kind === 'video'`; there is no click-through to `AssetViewer` or to an album.
- No marker clustering and no pagination UI: the whole geotagged set is loaded up front, which is why the route skips thumbnails entirely.
- `leaflet/dist/leaflet.css` is imported in this file, so map styles only ship with this route chunk.
- The map is torn down (`map.remove()`) and rebuilt when `assets`/`loading`/`error` change rather than diffing marker layers.
- The hand-rolled `AppHeader`+`Sidebar`+`UploadNotification` composition exists solely because `AppShell`'s padded scrollable `<main>` would break the full-viewport map.

## Flow

Mount → paged fetch → state `assets` → effect initializes map and markers → resize/unmount handled by Leaflet cleanup. Popups are display-only (no click-through into `AssetViewer`), and the map is replaced whenever `assets`/`loading`/`error` change.

## Integration

`api/assets` (`listAssets`), `lib/dateFormat` (`formatShortDate`), `components/{RequireAuth,AppHeader,Sidebar,UploadNotification}`, and the `leaflet` package (+ `leaflet/dist/leaflet.css`). No zustand store and no thumbnails are used on this route.
