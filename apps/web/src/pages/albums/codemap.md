# apps/web/src/pages/albums/

## Responsibility

Two routes: `/albums` (`index.tsx`) lists albums with client-side search and creation; `/albums/:id` (`[id].tsx`) shows one album with inline rename, description edit, deletion, adding photos, and a viewer that can remove the current asset from the album.

## Design

- List page: `useAlbums()` provides `albums`, `total`, `loading`, `error`, `refresh`, `create`. Search filters by name in-memory. `NewAlbumDialog` is local state — name (max 255, required) + optional description, calls `create` and closes; empty/grid states use `AlbumCover` (lazy first-asset cover) linking to `/albums/:id`, displaying `assetCount`.
- Detail page: `useAlbumAssets(id, 60)` for the asset page plus `getAlbum(id)` for name/description/count; both refresh after mutations. Title click → inline input with Enter/blur commit (`update(id,{name})`), Escape/cancel restores. Kebab menu: Edit name, Edit description (`window.prompt` → `update`), Delete (`remove` → `navigate('/albums')`).
- `AddPhotosDialog` is embedded in `[id].tsx`: loads `listAssets({limit: 60, isTrashed: false})`, multi-selects `GalleryItem`s with a check overlay, then `onAdd(ids)` → `addAssets` + `refreshAlbum`. It is not shared with `components/AlbumPickerDialog`, which does the inverse (given assets, pick albums).
- The viewer is lazy-loaded and wired through `useAssetNavigation({assets, onAfterAction: refresh both})`: favorite toggle, add-to-album (`AlbumPickerDialog`), remove-from-album (confirm → `removeAssetFromAlbum` → refresh both → close), trash, prev/next, sibling strip.
- `total > assets.length` renders a "Showing N of M" note (no infinite scroll/incremental load yet).
- Rename commits on Enter or blur with Escape cancel; an empty or unchanged trimmed name simply reverts to the stored name.
- Successful delete (`useAlbums.remove`, which confirms internally) navigates back to `/albums`; description edits go through `window.prompt` and patch the local album only.
- The description is rendered under the header with `whitespace-pre-line`, and `assetsError` is shown inline while the grid stays usable.
- `NewAlbumDialog` lives inside `index.tsx` (not `components/`) because only the albums list uses it.

## Flow

`/albums` → `useAlbums` → card grid → click → `/albums/:id` → parallel album + assets fetch → mutations refresh either assets, album, or both. Adding via picker/dialog only sends IDs; cover/thumbnails re-resolve lazily through `AssetThumb`.

## Integration

`api/albums` (`listAlbums`, `getAlbum`, `createAlbum`, `updateAlbum`, `deleteAlbum`, `listAlbumAssets`, `addAssetsToAlbum`, `removeAssetFromAlbum`), `api/assets` (`listAssets`), hooks `useAlbums`/`useAlbumAssets`/`useAssetNavigation`, components `AppShell`/`RequireAuth`/`AlbumCover`/`GalleryItem`/`AlbumPickerDialog`/lazy `AssetViewer`. Types from `@photox/shared-types` (`AlbumDto`, `Asset`).
