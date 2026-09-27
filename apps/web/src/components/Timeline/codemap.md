# apps/web/src/components/Timeline/

## Responsibility

`TimelineGrid` — the grouped justified gallery rendered by the timeline route (`/`). It turns `AssetGroup[]` (already fetched, date-sorted, and grouped by `useAssetGroups`) into sticky-month sections of `GalleryItem` tiles, wrapped in a `DropZone` so the whole timeline accepts drag-and-drop uploads.

## Design

- Fully controlled/composition-only: props are `groups`, `onSelect`, `selectedIds`, `onToggleSelect`, `onLongPress`, `showCheckbox`. It does not fetch, sort, or group — `useAssetGroups` owns that and `pages/index.tsx` owns the viewer/bulk-action state.
- Each section header is sticky (`top-0`, blurred background) and shows the group label plus a group-level Select all / Deselect all button that diffs against `selectedIds` only for unselected/selected members.
- `selectionMode = selectedIds.size > 0` is passed down so checkboxes stay visible once a selection exists.
- Tiles are laid out with the shared `justified-grid-gallery` CSS utility (defined in `app.css`) inside a `max-w-6xl` container.
- `onLongPress` is only wired on coarse-pointer devices by the page; touch selection vibrates via `navigator.vibrate(10)` there, not here.
- `DropZone` filters dropped files to images/videos and shows a full-screen overlay; upload enqueueing is entirely in `lib/upload`.
- No virtualization: every tile in every group renders at once (accepted for personal-library sizes; the hook already pages at 50).
- The group toggle flips only members whose selected state differs from the target, so it is a diff toggle rather than a blind select/deselect.
- Sticky headers rely on `AppShell`'s scrollable `<main>` as the scroll container; this component manages no scrolling of its own.

## Flow

Page renders `TimelineGrid groups={groups} onSelect={onClickAsset} …` → click either opens the viewer (`nav.open`) or toggles selection depending on `selectedIds.size` (page logic). Group headers call `onToggleSelect` once per member to flip the group. Dropped files → `enqueueFiles` → upload store → `useAppStore.bumpTimelineRefresh` → `useAssetGroups` refetch → new groups re-render.

## Integration

Single consumer: `apps/web/src/pages/index.tsx` (timeline/favorites/trash render their own grids manually). Depends on `../GalleryItem`, `../DropZone`, and the `AssetGroup` type from `hooks/useAssetGroups`. Group labels/keys come from `lib/dateFormat` (`groupDateLabel`, `groupDateSortKey`) applied in the hook, not here.
