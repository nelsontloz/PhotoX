# apps/web/src/pages/trash/

## Responsibility

`/trash` — soft-deleted assets grouped by their trash date, with restore, permanent delete, and empty-trash operations through the shared viewer.

## Design

- `useAssetGroups({ isTrashed: true, dateField: 'trashedAt' })` fetches trashed assets and groups by `trashedAt`; the page renders its own sticky-header sections (like favorites) rather than `TimelineGrid`. `GalleryItem` is rendered with `dark` dimming.
- `useAssetNavigation({assets, onAfterAction: refresh})` drives the eager `AssetViewer`: `onRestore` → `restoreAsset`, `onDelete` → `deleteAsset`, prev/next + sibling strip over the trashed list, and `onTrash`/favorite intentionally omitted.
- Add-to-album is passed only when `!nav.selected.isTrashed` (defensive: items in this list normally are trashed), with `AlbumPickerDialog` mounted next to the viewer.
- "Empty trash" header button: `window.confirm` → `emptyTrash()` → `refresh()`; spinner while in flight, `window.alert` on failure.
- Standard spinner / error+reload / "Trash is empty" states.
- `GalleryItem` gets `dark` to dim tiles; there is no multi-select or bulk bar — actions are per-asset inside the viewer.
- Restore and permanent delete both clear the `?asset` param before `onAfterAction` refreshes the groups.
- `Empty trash` is the only bulk operation; individual permanent delete keeps its own confirm inside `useAssetNavigation`.
- The page never calls `getAsset` itself, so richer details (faces, dims) in the viewer come from `AssetViewer`'s own refetch.
- Groups key on `trashedAt`, so an asset restored then re-trashed lands under a new date heading.

## Flow

Mount → `useAssetGroups` pages `listAssets({isTrashed:true})` and groups by `trashedAt` desc → tile opens viewer at `?asset=<id>` → restore or permanent delete calls the API, clears the param, refreshes the list. Empty trash wipes every trashed asset and refreshes once.

## Integration

Hooks `useAssetGroups` + `useAssetNavigation`; `api/assets` (`emptyTrash`, and `restoreAsset`/`deleteAsset` via the hook); components `RequireAuth`, `AppShell`, `GalleryItem`, `AssetViewer`, `AlbumPickerDialog`. Backend cleanup of freed files is a worker concern (`cleanup-asset`), not this page's.
