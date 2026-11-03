# Mobile: device folder → server album upload (plan)

Core + web shipped in `feat/album-hide-from-timeline` (`dcc5530`, `54b7255`). This doc is the
remaining mobile work. Nothing implemented yet.

## Shipped contract (do not redo)

- `albums.hiddenFromTimeline` boolean, migration `1794200000000-AlbumHiddenFromTimeline`,
  `CreateAlbumDto`/`UpdateAlbumDto.hiddenFromTimeline?`, `AlbumDto.hiddenFromTimeline: boolean`.
- `GET /api/v1/assets` and `/assets/layout` exclude assets in a hidden album; `?albumId=` bypasses,
  trash / `?ids=` / search / people / shares unaffected. ETag folds hidden membership in.
- Web album menu toggles the flag and shows a "hidden" indicator.

Mobile consequence to accept: the merged Library tab reads `GET /api/v1/assets`, so hidden-album
assets disappear there too.

## Target behaviour

On the Albums tab, each device folder can be pointed at one server album (existing, or created on the
spot with "hide from timeline"). Assets uploaded from that folder are added to that album, so a hidden
album's uploads never reach the timeline. Assets from unmapped folders behave exactly as today.

## 1. Server album client — new `lib/server/album_client.dart`

Mirror `server_assets_client.dart` (takes `ApiClient`, parses through `ApiClient.parseResponse`):

```dart
class ServerAlbum { final String id, name; final int assetCount; final bool hiddenFromTimeline; }

class AlbumClient {
  Future<List<ServerAlbum>> list();                                  // GET  api/v1/albums?limit=1000
  Future<ServerAlbum> create(String name, {required bool hiddenFromTimeline}); // POST api/v1/albums
  Future<void> addAssets(String albumId, List<String> assetIds);      // POST api/v1/albums/:id/assets
  Future<void> removeAsset(String albumId, String assetId);           // optional, unbinding
}
```

`PaginationQueryDto` allows `limit` up to 1000, so one page covers a normal account; page the loop only
if `total` exceeds the page size.
`addAssets` takes ≤100 ids per call (`AddAssetsBodyDto`), and the server `orIgnore`s duplicates, so
retries are safe.

Wire in `AppServices._build` next to `ServerAssetsClient` and pass it to both `SyncCoordinator` (linker)
and `PhotoXController` (UI).

## 2. Folder → album mapping — `lib/settings/settings_store.dart`

One new field on `AppSettings`:

```dart
final Map<String, String> folderAlbums; // device folder id -> server album id
```

- Persisted as JSON under the existing `settings` namespace (same as `uploadFolderIds`), read with a
  new `_readStringMap` that drops non-string values and malformed JSON.
- Extend `copyWith`, `==`, `hashCode`, `toString`, `toStorage`, `load`.
- Deliberately **not** a drift table: it is a handful of ids, written only from settings.
- Not part of `_scopeChanged` (it does not change what discovery reads), so `updateSettings` does not
  clear the watermark for it; the caller schedules a pass instead.

## 3. Which folder an asset came from — drift schema v3

Today nothing records it: `AssetCandidate` has no folder, `QueuedAssets` has no folder column, and
`scanNew` de-dups by asset id because one photo can sit in several device albums.

- `lib/media/photo_observer.dart`: `AssetCandidate.folderId` (nullable `String`).
- `photo_manager_observer.dart:scanNew`: `_displayCandidate(asset, folderId: album.id)` — first album
  the asset is seen in wins, matching the existing `seen` set.
- `lib/upload/database.dart`: `QueuedAssets.folderId` (nullable text) and
  `QueuedAssets.albumLinkedAt` (nullable dateTime); `schemaVersion => 3`; `onUpgrade` gets
  `if (from < 3) { await m.addColumn(queuedAssets, queuedAssets.folderId); await m.addColumn(queuedAssets, queuedAssets.albumLinkedAt); }`.
- `upload_queue.dart:enqueueAll`: write `folderId` on the insert companion **and** on both update
  branches (content-changed and unchanged), so a later scan re-attributes an existing row without
  touching its progress.
- New queue methods: `Future<List<QueuedAsset>> unlinkedUploaded({int limit = 100})` (state in
  `uploaded`/`duplicate`, `albumLinkedAt IS NULL`, `folderId IS NOT NULL`) and
  `Future<void> markAlbumLinked(Iterable<String> localIds)`; plus
  `Future<void> forgetFolderAlbum(String folderId)` (null `albumLinkedAt` so a re-map re-links).
- `dart run build_runner build` — `database.g.dart` is committed.

## 4. Linking — `lib/sync/sync_coordinator.dart`

The coordinator already runs in both isolates (UI and Workmanager), so linking works in the background
without new plumbing.

- Accumulate `Map<String /*albumId*/, Set<String> /*assetId*/>` while the upload loop runs: for every
  `UploadOutcome` with a non-null `serverAssetId` (covers both `uploaded` and `duplicate`), resolve
  `settings.folderAlbums[item.folderId]` and collect.
- Flush after the loop (and before `report.remaining`): `AlbumClient.addAssets` in ≤100-id chunks,
  then `queue.markAlbumLinked(localIds)` for the rows that went in.
- Sweep once per pass, before the upload loop: `unlinkedUploaded(limit: 100)` grouped by album, same
  flush. This is what makes a crash/offline between upload and link cost one pass instead of the
  album membership.
- Failure handling: 401/5xx/network → leave `albumLinkedAt` null (next pass retries, no user-facing
  error); 404 → the album is gone, so drop every `folderAlbums` entry pointing at it (persist through
  the settings store) and stop retrying that batch.
- New `Future<void> adoptFolder(String folderId)`: one `scanNew(since: null, folderIds: [folderId])`
  (no watermark change, no upload) so already-backed-up photos in that folder receive a `folderId`;
  the sweep then links them. Without this, only uploads made after the mapping ever join the album.
- `SyncReport` stays unchanged.

## 5. UI

- `lib/ui/albums_screen.dart` (screen never touches services — pass callbacks from `app.dart`):
  - new callbacks `Future<List<ServerAlbum>> Function() loadServerAlbums`,
    `Future<ServerAlbum> Function(String name, {required bool hiddenFromTimeline}) onCreateServerAlbum`,
    `Future<void> Function(String folderId, String? albumId) onFolderAlbumChanged`;
  - one menu row above the scope rows: "Save to server album…" → opens the sheet;
  - the card shows the mapped album's name with a small "hidden" chip when
    `ServerAlbum.hiddenFromTimeline` is true (so hiding is never invisible).
- New `lib/ui/widgets/folder_album_sheet.dart`: list of server albums (name, asset count, hidden
  badge) + "New album" row that reveals a name field and a `SwitchListTile` "Hide from timeline",
  **default on** for this flow; "Not in an album" row clears the mapping.
- `app.dart:_albums()` wires the three callbacks to the controller.

## 6. Controller — `lib/app_controller.dart`

- `List<ServerAlbum> get serverAlbums` + `Future<void> refreshServerAlbums()` (cached, refreshed when
  the sheet opens; failures surface as an inline sheet error, not a snackbar).
- `Future<ServerAlbum> createServerAlbum(String name, {required bool hiddenFromTimeline})`.
- `Future<void> setFolderAlbum(String folderId, String? albumId)`:
  `updateSettings(settings.copyWith(folderAlbums: …))` → `queue.forgetFolderAlbum(folderId)` →
  `await coordinator.adoptFolder(folderId)` → `unawaited(_syncAfterCurrent())`.
- `_wipeAccountData()` (`:627`): also clear `folderAlbums`, since album ids belong to the account that
  just signed out (a stale id 404s on every pass).
- Abstract `AppController` gets the same three members so screens stay controller-agnostic.

## Files touched

| File | Change |
|---|---|
| `lib/server/album_client.dart` | new: `ServerAlbum` + `AlbumClient` |
| `lib/settings/settings_store.dart` | `folderAlbums` field, JSON codec, load |
| `lib/media/photo_observer.dart` | `AssetCandidate.folderId` |
| `lib/media/photo_manager_observer.dart` | attribute folder in `scanNew` |
| `lib/upload/database.dart` (+ `database.g.dart`) | schema v3: `folderId`, `albumLinkedAt` |
| `lib/upload/upload_queue.dart` | write `folderId`, `unlinkedUploaded`, `markAlbumLinked`, `forgetFolderAlbum` |
| `lib/sync/sync_coordinator.dart` | album client, link accumulation + flush, sweep, `adoptFolder` |
| `lib/app_services.dart` | construct `AlbumClient`, pass to coordinator + controller |
| `lib/app_controller.dart` | album members, `setFolderAlbum`, sign-out reset |
| `lib/ui/albums_screen.dart`, `lib/ui/widgets/folder_album_sheet.dart`, `lib/app.dart` | folder → album UI |
| `test/unit/{settings,queue,sync_coordinator,photo_manager_observer}_test.dart`, `test/widget/albums_screen_test.dart`, new `folder_album_sheet_test.dart`, `album_client_test.dart` | coverage |
| `e2e/mobile/run.sh` | seed a second device folder (`DCIM/E2EAlbum`) |
| `integration_test/support/pipeline.dart`, new `integration_test/folder_album_test.dart` | on-device e2e (E1–E6) |

## Order

1. **Plumbing** (§2, §3 + build_runner). Unit tests: settings map round-trip, `enqueueAll` writes
   `folderId` for new and existing rows, migration path from v2.
2. **Album client** (§1) — independent of (1), separate files, can run in parallel.
3. **Linker** (§4) — needs (1) and (2). Unit tests with a fake `AlbumClient`: accumulation, chunking at
   100, sweep on the next pass, 404 drops the mapping, 401 leaves rows unlinked.
4. **UI + controller** (§5, §6) — needs (2) for data and (3) for `setFolderAlbum`.
5. Gates: `pnpm mobile:verify` (always) and `pnpm mobile:e2e` (opt-in, on device — see the next
   section). `pnpm verify` is untouched; mobile is outside turbo.

Lanes 1 and 2 can run in parallel; 3 and 4 stay sequential to avoid touching the same files twice.

## Mobile e2e (on device, `pnpm mobile:e2e`)

Existing harness: `e2e/mobile/run.sh` boots the compose stack + an AVD, seeds
`/sdcard/DCIM/Camera/{e2e-small,e2e-large}.jpg`, publishes core and runs
`apps/mobile/integration_test/*_test.dart`. `support/pipeline.dart` builds the background graph
(`AppServices.initializeBackground`) with a clean drift queue, `support/harness.dart` gives
`apiDio()`/`authHeader()` for the test's own server assertions. Each file registers a throwaway user.

Harness additions (not tests):

- `e2e/mobile/run.sh:seed_media`: push the small jpeg a third time as
  `/sdcard/DCIM/E2EAlbum/e2e-album.jpg` (same loop, new dir/name). Two device folders are what makes
  "only the mapped folder's uploads join the album" provable; one folder only proves linking works.
- `support/pipeline.dart` helpers: `seededFolder(services, name)` (matches `observer.folders()` by
  name, fails loudly if the seed is missing), `createAlbum(services, name, {hidden})`,
  `mapFolder(services, folderId, albumId)` (writes `folderAlbums` through `SettingsStore`),
  `albumAssetIds(services, albumId)` and `timelineAssetIds(services)` (both via `apiDio()`).
- Note for every test: the mapping does **not** add a folder to the backup scope. A non-camera folder
  also needs `uploadFolderIds` (or `uploadAllFolders: true`) before `coordinator.run()` will scan it.

Tests, one file `integration_test/folder_album_test.dart` (all `timeout: 10 min`, mirroring
`upload_dedup_test.dart`):

- **E1 mapped folder lands in the album, unmapped folder does not.** Map `E2EAlbum` → a *visible*
  album, scope both folders, run a pass. Album holds `e2e-album.jpg`'s asset id and not the camera
  photo's; both stay on `GET /api/v1/assets`; both rows have `albumLinkedAt` set. Proves linking and
  that a normal album changes nothing on the timeline.
- **E2 hidden album: uploads leave the timeline, album keeps them.** Map `Camera` → an album created
  with `hiddenFromTimeline: true`, run a pass. `GET /api/v1/assets` returns neither seeded asset;
  `GET /api/v1/albums/:id/assets` and `GET /api/v1/assets?albumId=<id>` return both. This is the
  user-facing story end to end.
- **E3 a folder backed up before it was mapped joins the album** (the `adoptFolder` path). Upload the
  camera photo with no mapping, assert it is on the timeline and the album empty; then create the
  hidden album, map, `coordinator.adoptFolder(cameraFolderId)` + `run()`; assert the *same* asset id is
  now in the album and gone from the timeline, and `serverAssetTotal` did not grow.
- **E4 dedup hits are linked, not just fresh uploads.** With the photo already in the hidden album,
  `resetQueueOnly` + a second pass (the "second device" shape used by `upload_dedup_test`); assert
  total assets unchanged, the album still holds exactly one asset, the row ends `uploaded` with
  `albumLinkedAt` set.
- **E5 the sweep repairs an unlinked row.** After E2-style linking, call `queue.forgetFolderAlbum`
  (nulls `albumLinkedAt`) and run another pass; the album still holds the asset, no second asset is
  created, and `report.error` is null.
- **E6 a deleted album drops the mapping instead of looping.** Map the folder, `DELETE
  /api/v1/albums/:id`, add a fresh seeded photo, run a pass. The upload still succeeds, the asset
  appears on the timeline (no album holds it), `settings.folderAlbums` no longer contains the folder,
  and a third pass reports no error and makes no failing request.

Not covered on device (deliberately): the album sheet UI. It is driven purely by a fake `AlbumClient`
in widget tests, so an on-device UI flow would re-test the platform library rather than the feature.

## Limits and risks

- A photo that lives in two device folders is attributed to the first folder the scan reaches, so it
  can only land in one folder's album.
- Historical assets join an album only through `adoptFolder`; a folder never re-scanned (permission
  revoked, folder deleted) keeps its assets out of the album.
- Mapping a folder does not hide the album by itself: only albums created/edited with the flag are
  hidden. A user mapping to a pre-existing visible album keeps those uploads on the timeline —
  intentional, but the sheet should say so.
- Album deletion is detected only when a link attempt 404s, so a dead mapping lingers until the next
  upload from that folder.
- Linking is one HTTP call per 100 assets per pass; a first-time 20k-photo folder will take many
  passes at the 25 s background budget. Acceptable because `adoptFolder` runs in the foreground.
- No mobile-side "which albums are hidden" cache: the badge is read from `GET /albums` at sheet open,
  so it can be stale until the sheet is reopened.

## Non-goals

Removing an asset from an album on mobile, browsing server albums as a grid, hiding individual assets,
and changing search/people/shares visibility (core keeps those surfaces showing hidden-album assets).
