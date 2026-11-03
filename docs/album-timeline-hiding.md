# Plan — per-album "hidden from timeline" (backend + web + e2e)

Status: plan only, nothing implemented. Scope: `apps/core`, `packages/shared-types`, `apps/web`, `e2e`.
No mobile work in this plan.

## Goal

1. An album can be marked **hidden from timeline**. Assets that belong to at least one hidden album do
   not appear on the timeline.
2. Albums without the flag behave exactly as today (their assets still show on the timeline).
3. Hiding is retroactive: flag on → the album's assets leave the timeline; flag off (or album deleted)
   → they come back. Nothing is deleted or re-uploaded.

## Decisions

- **Rule:** timeline = assets whose album set contains **no** hidden album. Not "album-less only":
  membership in a normal album still shows on the timeline, so the existing e2e step
  "my timeline still contains the album photo" (`e2e/steps/albums/albums.steps.ts:228`) stays green as
  the control case.
- **Any-hidden wins:** an asset in both a hidden and a normal album is hidden.
- **Explicit album view wins:** `GET /api/v1/assets?albumId=…` (what the web album page uses via
  `useTimelineView({ albumId })`) must keep returning that album's assets even when hidden. The
  exclusion is skipped whenever an `albumId` filter is present.
- **No per-asset column, no backfill, no upload-ingest change.** Album membership already exists in
  `album_assets`; the flag lives on the album.
- Flag is **update-only** (`UpdateAlbumDto`); new albums default to `false` and get hidden from the
  album page menu. (A create-time flag is a 3-line addition if a client ever needs it.)
- Timeline-scoped only. Search, semantic search, persons/places, shares and face thumbnails keep
  showing hidden-album assets — out of scope, documented.

## Backend (`apps/core`, `packages/shared-types`)

1. **Flag on the album**
   - `albums/entities/album.entity.ts`: `@Column({ type: 'boolean', default: false }) hiddenFromTimeline!: boolean;`
   - Migration `database/migrations/<ts>-AlbumHiddenFromTimeline.ts`:
     `ALTER TABLE albums ADD COLUMN "hiddenFromTimeline" boolean NOT NULL DEFAULT false` (+ `down`).
     Dev DBs run `synchronize`; a synchronize-era DB still has to be marked migrated before prod
     applies it — same caveat the existing migrations carry.
   - `albums/dto/update-album.dto.ts`: optional `@IsBoolean() hiddenFromTimeline?: boolean`
     (`forbidNonWhitelisted` means the field 400s today, so this is required, not optional).
   - `albums/albums.service.ts`: thread it through the existing `patch` object in `update()`
     (`:75-80`), and return it from `toDto()` (`:170`).
   - `packages/shared-types/src/albums.ts`: `AlbumDto.hiddenFromTimeline: boolean`,
     `UpdateAlbumDto.hiddenFromTimeline?: boolean`.

2. **Timeline exclusion** — `apps/core/src/assets/assets.service.ts`
   - New private helper, applied in `list()` (after `:95`) and `layout()` (after `:163`):
     ```sql
     NOT EXISTS (
       SELECT 1 FROM album_assets aa
       JOIN albums al ON al.id = aa."albumId"
       WHERE aa."assetId" = asset.id
         AND al."userId" = :userId
         AND al."hiddenFromTimeline"
     )
     ```
     Skipped when `albumId` is set. `:userId` is already bound in both builders.
   - Deliberately **not** in `applyAssetFilters()` (shared with album-scoped reads) and **not** in
     `listByIdsRanked()` (album contents + search ranking).
   - Indexes: `albums(userId)` exists and `album_assets` has a composite PK `(albumId, assetId)` +
     index on `assetId`, so the subquery is indexed as-is. No new index.

3. **Layout ETag** — `layoutFingerprint()` (`:193`) must include hidden-album state, or the grid
   geometry changes behind a matching ETag (album membership never bumps `assets.updatedAt`; the
   controller comment at `assets.controller.ts:50` already documents this hazard). Add a second
   aggregate scoped to the user:
   - `COUNT(*)` of `album_assets JOIN albums WHERE al."userId" = :userId AND al."hiddenFromTimeline"`
   - `MAX(GREATEST(al."updatedAt", aa."addedAt"))`
     Fold both into the ETag string. `albums.updatedAt` also moves on rename → harmless extra
     invalidation. The filtered-layout path keeps skipping revalidation.

4. **No behavioural change elsewhere:** `assets.getOne`, trashed list, shares, search, faces, admin
   reads, and the worker's `GET /api/v1/assets?ids=` ranking read are untouched (`list` with `ids`
   still passes through the new subquery, which is the intended timeline semantics).

## Web (`apps/web`)

1. `pages/albums/[id].tsx` — album options menu (`button[aria-label="Album options"]`, JSX at
   `:263-299`): one entry between "Share album" and the divider, label toggling
   `Hide from timeline` → `Show on timeline` (icon from `react-icons/fa6`). Handler mirrors
   `handleEditDescription` (`:145`): close menu, `updateAlbum(id, { hiddenFromTimeline: !album.hiddenFromTimeline })`,
   `setAlbum(updated)`, then `bumpTimelineRefresh()` so the home timeline refetches instead of serving
   its cached months.
2. Header: when `album.hiddenFromTimeline` render a small `Hidden from timeline` pill next to the
   `{assetCount} items` label (`:249`) so the state is visible without opening the menu. Visual
   treatment (spacing, colour, icon) is @designer's call; the text is the e2e hook.
3. `api/albums.ts` — no change; `UpdateAlbumDto` gains the field via `shared-types` and typecheck
   enforces it.
4. Nothing else: the home timeline, favourites, people and album pages all filter server-side.

**Known UX consequence to accept in v1:** `AddPhotosDialog` (the album page's "Add photos" picker,
`pages/albums/AddPhotosDialog.tsx`) sources from the timeline, so photos already in a hidden album no
longer appear there and cannot be re-added to another album from the web UI. Upgrade path: an
`includeAlbumHidden` flag on the picker's `listAllAssets` call.

## e2e (`e2e`)

New feature file `e2e/features/06-albums/albums-hidden.feature` (picked up automatically: the `suite`
project globs `features/**/*.feature`, scenarios are user-scoped so they parallelise). All assertions
are API-first — no coupling to empty-state copy — plus two UI scenarios for the menu toggle.

**Steps to add in `e2e/steps/albums/albums.steps.ts`** (reuse `createAlbumViaApi`, `addAssetsViaApi`,
`uploadViaApi`, `authHeaders`, `requireAuth`, `currentAlbum`, `albumAssetAt`):

| Step                                                   | Implementation sketch                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `When I hide the album from the timeline`              | `PATCH /api/v1/albums/:id {hiddenFromTimeline:true}` → `ctx.lastStatus`                                                |
| `When I show the album on the timeline`                | same with `false`                                                                                                      |
| `Then the album reports hidden from the timeline`      | `GET /albums/:id` → `hiddenFromTimeline` true                                                                          |
| `Then my timeline does not contain the album photo`    | `GET /api/v1/assets` → ids not containing `albumAssetAt(ctx,0)`                                                        |
| `Then the timeline is empty`                           | `GET /api/v1/assets` → `total === 0` (scenario-scoped user)                                                            |
| `Then the timeline layout is empty`                    | `GET /api/v1/assets/layout` → `items.length === 0`                                                                     |
| `Then the timeline layout only omits the hidden photo` | same call with one visible + one hidden asset → `items.length === 1`                                                   |
| `Then the timeline layout ETag changes after hiding`   | capture `GET /assets/layout` ETag → hide → conditional `GET` with `If-None-Match` must return 200 and a different ETag |
| `When I hide the album from its options menu`          | open `button[aria-label="Album options"]`, `waitForResponse` PATCH 200 while clicking `Hide from timeline`             |
| `When I show the album from its options menu`          | same with `Show on timeline`                                                                                           |
| `Then the album page shows the hidden badge`           | `expect(page.getByText('Hidden from timeline')).toBeVisible()`                                                         |

**Scenarios**

API / contract (`albums-hidden.feature`):

1. _Hiding an album removes its photo from the timeline but not from the album_ — upload 1 photo, add
   to album, hide → timeline total 0; `GET /albums/:id/assets` still 1; `GET /albums/:id` reports the
   flag.
2. _Showing a hidden album puts its photo back on the timeline_ — hide then show → timeline contains it
   again.
3. _Deleting a hidden album returns its photo to the timeline_ — hide, delete album → timeline contains
   it (the `NOT EXISTS` join has no rows left).
4. _A normal album keeps its photo on the timeline_ — control case, guards against an over-broad
   filter.
5. _The album-scoped timeline still lists a hidden album's photos_ — `GET /api/v1/assets?albumId=…`
   contains the photo while the unfiltered list does not.
6. _Hiding one album leaves another album's photo on the timeline_ — two albums, two photos, hide one →
   timeline has exactly the second; layout length 1.
7. _The timeline layout ETag changes after hiding_ — covers the fingerprint requirement; without it the
   web grid can keep stale geometry.
8. _Hiding an empty album changes nothing_ — no assets, timeline untouched, flag set.

UI (`albums.feature`, appended): 9. _Hiding an album from its options menu removes its photo from the timeline_ — create album via API,
add photo, open album, hide via menu, badge visible, `page.goto('/')` then assert via
`GET /api/v1/assets` that it is gone; album page still shows 1 item. 10. _Showing a hidden album from its options menu restores it on the timeline_ — same flow in reverse,
end on the API assertion.

Regression guard: keep scenario _"Deleting an album keeps its photos on the timeline"_ and
_"Removing a photo from an album keeps it on the timeline"_ untouched — both must still pass, proving
non-hidden albums are unaffected.

## Test plan outside e2e

- `apps/core/src/assets/assets.service.spec.ts`: hidden-album asset absent from `list` and `layout`;
  present again after the flag clears; `albumId` filter bypass; `layoutFingerprint` changes when the
  flag flips and when a member is added to a hidden album; non-hidden album unchanged.
- `apps/core/src/albums/albums.service.spec.ts`: `hiddenFromTimeline` round-trips through
  `update()`/`toDto()`; omitted field leaves the value untouched.
- Full gate: `pnpm verify` (lint → tests → typecheck → build → e2e with `E2E_BUILD=1`).

## Lanes

1. **backend** (entity, migration, DTO, service, query, fingerprint, shared-types, unit specs) — lands
   first; the wire field gates the web lane.
2. **web** (menu toggle, badge, refresh bump) — needs 1 for `AlbumDto.hiddenFromTimeline`.
3. **e2e** (feature files + steps) — needs 1 for the API scenarios; its UI scenarios need 2, so it runs
   after or alongside the end of lane 2. Validation owner runs the suite.

## Risks / limits (accepted for v1)

- Hidden-album assets stay reachable in search, persons/places and shares; the rule is timeline-only.
- Hidden-album photos cannot be added to another album from the web "Add photos" picker (it reads the
  timeline).
- Every default timeline layout request now carries two extra aggregate subqueries for the ETag; cheap
  on the existing indexes but unmeasured.
- Hiding an album affects the owner's timeline only; shared links to that album keep serving it.
- Flag changes don't touch `assets.updatedAt`, so any other client caching `/assets` by asset
  mutation time (none in this repo) would go stale; the layout fingerprint above is the only such
  consumer.
