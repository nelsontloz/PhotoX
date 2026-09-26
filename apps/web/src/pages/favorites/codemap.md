# apps/web/src/pages/favorites/

## Responsibility

`/favorites` — date-grouped grid of hearted assets (`favorite: true`), with the shared viewer for un-favoriting, album add, and navigation.

## Design

- Data comes from `useAssetGroups({ favorite: true })`; the page renders its own group sections (sticky month header + `justified-grid-gallery`) instead of reusing `TimelineGrid`, because favorites has no multi-select/bulk bar.
- `useAssetNavigation({assets: all group items, onAfterAction: refresh})` drives the viewer. Un-favoriting from `AssetViewer.onToggleFavorite` calls `nav.toggleFavorite` → `updateAsset(id,{favorite})` → refresh, so the asset drops out of the list on the next fetch.
- Viewer is imported eagerly (unlike timeline/albums/people) and gets `onAddToAlbum` + `AlbumPickerDialog` for a single asset; no trash action is exposed here.
- States: spinner, error with `window.location.reload()` retry, empty state prompting the heart action; `GalleryItem` is used without `selectedIds`/checkbox props.
- Viewer actions exposed here: prev/next, favorite toggle, add-to-album, sibling strip. Trash/restore/delete are intentionally absent.
- Un-favoriting is not optimistic: the tile disappears only after `updateAsset` resolves and `useAssetGroups.refresh` refetches (the viewer's local `favOverride` bridges the gap visually).
- `AlbumPickerDialog` mounts only together with the viewer (`nav.selected`), so the asset ids stay valid while the picker is open.
- `useAssetGroups` filters assets lacking `takenAt`/`uploadedAt`, so undated favorites do not appear in any group.
- There is no selection mode or bulk bar; favorite toggling happens exclusively through the `AssetViewer` heart.

## Flow

Mount → `useAssetGroups` pages `listAssets({favorite:true})` 50 at a time, sorts by `takenAt ?? uploadedAt` desc, groups by month → grid. Tile click → `nav.open` writes `?asset=<id>` → viewer → favorite/add-to-album actions hit the API and refresh groups.

## Integration

`hooks/useAssetGroups` + `hooks/useAssetNavigation`, `components/{RequireAuth,AppShell,GalleryItem,AlbumPickerDialog,AssetViewer}`, `api/assets` indirectly through the hooks. Grouping labels come from `lib/dateFormat` inside the hook. Protected by `RequireAuth` inside `AppShell`.
