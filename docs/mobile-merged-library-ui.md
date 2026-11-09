# Merged Library — UI spec

Applies to the **Library tab only** (`LibraryScreen` with `folderId == null`). The album screen pushed from Albums (`folderId != null`, `album != null`) stays device-only: a device album cannot contain an item that is not on the device. Guard on `folderId == null` and leave that path untouched.

Data seam (for the fixer, not a UI decision): rows become one `LibraryItem` (optionally a device candidate, optionally a server asset, plus the layer-decided provenance). `AssetTile.asset`, `loadPreview`, `loadDetail`, `onBackUpNow` and `_openViewer`'s snapshot move to it. The UI never derives provenance from ids or from queue rows.

## 1. The three provenance marks

One mark, one slot: the bottom-right position `AssetTile` already gives the status badge (`Positioned(right: 5, bottom: 5)`). No new corner, no footer strip — at 4 columns on a 390 pt phone a tile is ~88 pt and a footer would eat 20% of the photo.

New widget `lib/ui/widgets/provenance_badge.dart` (`ProvenanceBadge`), same `_BadgeStyle` shape as `StatusBadge`, `size = StatusBadge.size` (22). `StatusBadge` is not modified.

| Provenance   | Glyph                   | Size | Colour                    | Mount                                  | Semantics label |
| ------------ | ----------------------- | ---- | ------------------------- | -------------------------------------- | --------------- |
| `both`       | `Icons.check_rounded`   | 14   | `scheme.primary`          | disc, scrim `0x8C000000`               | `Backed up`     |
| `deviceOnly` | `Icons.circle_outlined` | 9    | `scheme.onSurface @0.6`   | disc, scrim                            | `Not backed up` |
| `onlineOnly` | `Icons.cloud_outlined`  | 15   | `scheme.onSurfaceVariant` | **no disc**, `Shadow(blur 3, black54)` | `Online only`   |

`both` and `deviceOnly` deliberately reuse the exact glyph, size and colour `StatusBadge` uses today for `backedUp` and `unknown` — a not-backed-up tile must look identical before and after this change. `onlineOnly` is the only new mark, so it gets the only new shape language: the bare glyph with no disc behind it. That gives three silhouettes that survive greyscale and colour blindness: **tick on a disc / hollow dot on a disc / disc-less cloud**.

Accessibility: `AssetTile`'s Semantics label becomes `'<fileName>, <provenance label>'` (`"IMG_1234, Not backed up"`) and the badge stays `ExcludeSemantics`-wrapped so nothing is read twice. The `ProvenanceBadge` keeps its own `Semantics(label:)` for the standalone case (viewer bar).

## 2. Priority inside the one slot

`AssetTile` draws exactly one mark in that slot:

1. **uploading** (live `progress`, fraction ring) — `StatusBadge`
2. **failed** — `StatusBadge`
3. **queued** — `StatusBadge`
4. provenance — `ProvenanceBadge`

Rules 1–3 only ever exist on `deviceOnly` rows, so the slot never loses its meaning: an in-flight or broken upload already says "not on the server". A `both` row can never be uploading/failed/queued, and `onlineOnly` has no queue row at all.

Everything else keeps its corner: video play glyph top-left (`_VideoMark`), selection circle top-right (`_SelectionMark`), `selected` border. Still two marks per tile + the selection pair — the merged view adds none.

`excluded` (unsupported container, videos off) stays `StatusBadge(excluded)` (`do_not_disturb_alt`): it is a `deviceOnly` sub-state and today's behaviour, and the "Not backed up" chip counts it as before.

## 3. Filter chips

`All` / `Not backed up` / `Online only` / `Failed` — same `_filterChip`, same `+` suffix while `_hasMore`.

| Chip          | Counts                                           | Why                                                  |
| ------------- | ------------------------------------------------ | ---------------------------------------------------- |
| All           | every loaded item                                |                                                      |
| Not backed up | `deviceOnly` (queued, failed, unknown, excluded) | the actionable pile: photos this phone should upload |
| Online only   | `onlineOnly`                                     | the "not on this phone" pile                         |
| Failed        | `deviceOnly` + `failed`                          | the only sub-state needing intervention              |

They partition cleanly: All = both + deviceOnly + onlineOnly, Failed ⊂ Not backed up, Online only disjoint from both. Keep `_LibraryFilter.all/notBackedUp/onlineOnly/failed`; `_matchesFilter` switches on provenance, and `Failed` additionally on `_statusOf == failed`.

**The scope pill does not survive on the main tab.** In a merged timeline it would describe the device half of a list that is partly not on the device at all. Delete `ScopePill` from `_infoRow` (it stays in `home_screen.dart` and the album screen). The existing `_scopeBanner` already says the scope out loud, in words, exactly when it matters — that is the replacement, and it needs no new widget.

## 4. Info row

`_infoRow` becomes: `1,204 items · 38 not backed up · 12 online only`, then the unchanged "Backing up" spinner.

- `+` suffix on the whole line while `_hasMore`, as today.
- Online-only count while the server half has not answered: `· Checking the server…` instead of a number (a `0` there is a lie).
- Hide `Online only`/`Not backed up` counts (and the chips) only in the degraded cases in §5, never for “0”.

## 5. States that did not exist before

**At most one banner above the grid**, priority: server unreachable > permission blocked > scope. Three stacked `StatusBanner`s in a dense screen is a wall.

- **Server unreachable, device fine** — `StatusBanner(tone: warning, icon: Icons.cloud_off_rounded, title: 'Server unavailable', message: 'Showing photos on this phone. Server photos reappear when the connection is back.', action: TextButton('Try again'))` in the `_scopeBanner` slot. Device rows render normally; `onlineOnly` rows disappear rather than grey out (a greyed row would claim content it cannot show), and the `Online only` chip hides.
- **Permission blocked, server fine** — reuse `_permissionState`'s banner, but above the grid instead of replacing the body, when server items exist: `title: 'Photo access is off'`, `message: 'Server photos are shown. Allow photo access to see and back up this phone's photos.'`, action calls `onRequestAccess`. With no server items either, keep today's full-screen `_permissionState`. `Not backed up` / `Failed` chips hide; no device rows means no selection.
- **Empty on both** — `_emptyLibrary` unchanged in structure; body becomes `'Nothing on this phone or on the server yet. Photos appear here from either side.'`
- **Server half still loading / first index** — no skeletons, no placeholder tiles. The existing `_footer` spinner is the only signal; the info row carries `Checking the server…`. Constraint on the data layer: a page that arrives while the user is scrolled must append, never insert above the viewport, or the grid shifts under the finger.

## 6. Affordances

Ship: tap opens the viewer for all three states. That is the one interaction a grid tile already has.

- `deviceOnly` — unchanged: opens the viewer, "Back up now" lives there and in selection mode. Do **not** add a second tap target per tile; 88 pt has no room and long-press is already selection.
- `onlineOnly` — opens the viewer on the server preview (display resolution, not the original download). Long-press is a no-op for these rows: do not wire `onLongPress`, do not draw a selection tick, and exclude them from `_selectionCanBackUp`.
- Left out this pass: "Download to this phone" (camera-roll write, a new grant, a second copy), server-side video playback (poster + timestamp only), and multi-select of `onlineOnly` rows.

## 7. Viewer

`ViewerScreen._StatusBar` reads provenance first, queue detail second:

- `both` — `StatusBadge(backedUp)`, `'Backed up'` (drop "from this phone": the server copy may have come from another device).
- `deviceOnly` — unchanged: `'Not backed up yet'`, hint `'This phone has not uploaded these bytes.'`, `Back up now`.
- `onlineOnly` — `ProvenanceBadge(onlineOnly)`, `'Online only'`, hint `'Not on this phone.'`, **no "Back up now"** (nothing to enqueue). No timeline bar for server videos.

## 8. Day headers

**No provenance rollup.** `_DayHeader` keeps `label` + count, where count is merged items per day (one row per item, never photo+server double counting). A second number per day costs horizontal space in every header for a stat nobody acts on; the chips carry the global counts and the mark sits at the point of decision. The sticky bar, `MonthRail` and `_months` need no change — rows still carry `takenAt`, and undated server items fall into the existing `Undated` group.

## Deliberately skipped

Server-side video playback, download-to-device, per-chip counts on the day bar, and any change to `StatusBadge`'s six states.
