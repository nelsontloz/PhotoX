# apps/web/src/components/

## Responsibility

Shared UI for every file-based route: app chrome (`AppShell`, `AppHeader`, `Sidebar`), auth gates (`RequireAuth`, `RequireAdmin`), media primitives (`AssetThumb`, `VideoPlayer`, `FaceThumb`, `AlbumCover`, `Skeleton`), the gallery tile (`GalleryItem`) and its timeline composition (`Timeline/TimelineGrid`), upload UX (`DropZone`, `UploadButton`, `UploadNotification`, `UploadListItem`), and album assignment (`AlbumPickerDialog`). Components own no route data: pages fetch assets/albums and pass them down as props.

## Design

- `AppShell` is the layout contract: `AppHeader` + `Sidebar` + scrollable `<main>` + fixed `UploadNotification`. There is no central layout route; each page renders `<RequireAuth><AppShell>…`. It also exposes the `<main>` ref through `ScrollContainerContext` / `useScrollContainer()` so scroll-dependent UI (timeline virtualization) keys off the same container the sticky headers do — consumers listen themselves; AppShell owns no scroll state.
- Auth gates are independent: `RequireAuth` reads `useAuthStore.status` (spinner while `loading`, `<Navigate to="/login" state={{from}}>` otherwise) and subscribes to `subscribeAuthFailure` so a failed refresh kicks the user to `/login`. `RequireAdmin` only checks `user.role === 'admin'`, else redirects `/`.
- `Sidebar` is `NavLink`-driven (`/`, `/albums`, `/favorites`, `/people`, `/shared`, `/places`, bottom: `/trash`, `/admin` only for admins) and collapses icon-only at `lg`.
- `GalleryItem` is the single tile primitive: `figure role="button"` with Enter/Space handling, `useLongPress` for touch selection, checkbox with `selectionMode`, video badges driven by `asset.transcodeStatus` (pending spinner / failed warning / ready play), `faceCount` badge, and an `overlay` slot (used for `FaceOverlay` on person detail).
- `AssetThumb` lazy-loads via `IntersectionObserver` (200px margin): prefers a local upload preview from `useThumbStore.urls[fileId]`, else `listThumbnails` → pick `md` → `downloadFile` blob → object URL. Object URLs live in a module-level `Map<fileId, url>` for the session (`// ponytail: session-long objectURL cache, LRU if memory ever matters`) and are never revoked — timeline virtualization remounts tiles constantly, so a blob downloads once per session instead of once per mount. `AlbumCover` (first asset of the album, limit 1) and `FaceThumb` (`downloadFaceThumb` + AbortController) use the same lazy pattern (no cache).
- `DropZone` uses a dragenter/leave counter ref to avoid overlay flicker, filters `image/*`/`video/*`, and calls `enqueueFiles`. `UploadButton` is a hidden multi-file input (default hero + `compact` for `AppHeader`).
- `UploadNotification` is a fixed bottom-right panel subscribed to `useUploadStore` + `useThumbStore`: sorts items by status order, aggregates bytes/progress, collapses and dismisses; when all done it calls `clearDone()`.
- `AlbumPickerDialog` is a `useReducer` state machine (loading / create / select) over `listAlbums({limit: 1000})`, then `createAlbum` + `Promise.all(addAssetsToAlbum)`; Escape closes.
- `VideoPlayer` falls back to `fallbackSrc` exactly once on a `<video>` error, shows a spinner until `loadedmetadata`, and renders a `role="alert"` unsupported-format panel when both sources fail; `muted` is forced when `autoPlay`.
- `AppHeader` reads `useAuthStore` for user/initials/logout (logout → `navigate('/login')`) and embeds the compact `UploadButton`; the search, filter, and notification controls are presentation-only placeholders, not wired to the API.
- `Skeleton` is the shared `animate-pulse` placeholder used by `AssetThumb` and `FaceThumb` while blobs resolve.

## Flow

Upload: `enqueueFiles` (`lib/upload`) → `useUploadStore.enqueue` → 3 concurrent workers upload, generate a client thumbnail (`useThumbStore`), and on completion `useAppStore.bumpTimelineRefresh()` — one signal that refetches the timeline layout and re-fetches only the months on screen. Thumbnails resolve local blob first → API blob second → skeleton/fallback icon last. Viewed assets flow back through page callbacks (`onSelect`, `onToggleSelect`, `onLongPress`), never through global state.

## Integration

Pages under `src/pages/` import these directly: `TimelineGrid` only on `/`; `GalleryItem` on favorites, trash, albums detail, people detail; `AlbumPickerDialog` + lazy `AssetViewer` on timeline, favorites, albums detail, people detail, trash. Data APIs: `api/assets`, `api/albums`, `api/faces`, `api/shares`. Stores: `auth-store`, `upload-store`, `thumb-store`, `app-store`. Hooks: `useLongPress`. All requests go through `api/client` (baseURL `/api`) to the core API.
