# apps/web/src/components/Timeline/

## Responsibility

`TimelineGrid` — the grouped justified gallery rendered by the timeline route (`/`). It turns `AssetGroup[]` (already fetched, date-sorted, and grouped by `useAssetGroups`) into sticky-month sections of `GalleryItem` tiles, wrapped in a `DropZone` so the whole timeline accepts drag-and-drop uploads.

## Design

- Fully controlled/composition-only: props are `groups`, `onSelect`, `selectedIds`, `onToggleSelect`, `onLongPress`, `showCheckbox`. It does not fetch, sort, or group — `useAssetGroups` owns that and `pages/index.tsx` owns the viewer/bulk-action state.
- Each section header is sticky (`top-0`, blurred background) and shows the group label plus a group-level Select all / Deselect all button that diffs against `selectedIds` only for unselected/selected members.
- `selectionMode = selectedIds.size > 0` is passed down so checkboxes stay visible once a selection exists.
- Tiles are laid out with the shared `justified-grid-gallery` utility (defined in `app.css`) plus its `fixed-row-gallery` modifier, inside a `max-w-6xl` container. The modifier is applied ONLY here — favorites/trash/albums/people keep plain `justified-grid-gallery` (variable ≥200px rows).
- **Fixed-row contract**: every photo row is exactly `--row-height` tall and CSS flex-wrap greedily packs rows from the items' aspect ratios alone, so full month-section height is computable from data (no DOM measurement, no image-load layout shifts). Exact formula, constants included:
  - `headerHeight` = 49px (sticky header: `py-2` 8+8, `text-2xl` line box 32, 1px transparent `border-b`) + `mb-4` 16px before the grid = **65px**
  - `rowHeight` = **200px** at viewport ≥640px (`40rem`), **140px** below (media query on the modifier)
  - gap **4px** between rows/columns, section `mb-10` = **40px**
  - `rows` = pure greedy pack of natural widths `wᵢ = rowHeight × widthᵢ/heightᵢ`: place on the current row while `rowHeight × Σaspect + 4 × (count − 1) ≤ W`, with `W = min(1152px, viewport − 64px)` on desktop (`sm:px-8`) or `viewport − 32px` (`px-4`) on mobile — a pure function of the items' `w/h` and container width, executed by flex-wrap.
  - `monthSectionHeight = 65 + rows × rowHeight + (rows − 1) × 4 + 40 (mb-10)` = `headerHeight + rows × (rowHeight + 4) + fixed section margins − 4` (the target form minus the trailing gap that doesn't exist after the last row). Bare box height without the `mb-10` margin is the same minus 40.
  - Last row stays ragged (not stretched): the `::after` filler absorbs free space, and under the modifier it carries `flex-basis: 0` + `margin-left: -4px` so it can never wrap onto its own line (a phantom line would add an extra gap and break the formula above).
  - Known ceiling (marked `ponytail:` in `app.css`): extreme-aspect images (panoramas) are center-cropped to the fixed row height instead of becoming short rows — the cost of predictable height.
- `onLongPress` is only wired on coarse-pointer devices by the page; touch selection vibrates via `navigator.vibrate(10)` there, not here.
- `DropZone` filters dropped files to images/videos and shows a full-screen overlay; upload enqueueing is entirely in `lib/upload`.
- No virtualization: every tile in every group renders at once (accepted for personal-library sizes; the hook already pages at 50).
- The group toggle flips only members whose selected state differs from the target, so it is a diff toggle rather than a blind select/deselect.
- Sticky headers rely on `AppShell`'s scrollable `<main>` as the scroll container; this component manages no scrolling of its own.

## Flow

Page renders `TimelineGrid groups={groups} onSelect={onClickAsset} …` → click either opens the viewer (`nav.open`) or toggles selection depending on `selectedIds.size` (page logic). Group headers call `onToggleSelect` once per member to flip the group. Dropped files → `enqueueFiles` → upload store → `useAppStore.bumpTimelineRefresh` → `useAssetGroups` refetch → new groups re-render.

## Integration

Single consumer: `apps/web/src/pages/index.tsx` (timeline/favorites/trash render their own grids manually). Depends on `../GalleryItem`, `../DropZone`, and the `AssetGroup` type from `hooks/useAssetGroups`. Group labels/keys come from `lib/dateFormat` (`groupDateLabel`, `groupDateSortKey`) applied in the hook, not here.
