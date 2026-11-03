# PhotoX Mobile

iOS + Android app that backs up the device camera roll to a self-hosted
[PhotoX](../..) server. Flutter, Material 3, dark theme by default.

**Status: implemented.** Auth, media discovery, the persistent upload queue,
hashing/dedup, single-request and resumable uploads, background scheduling, and
the settings/queue UI are wired. Platform background execution is
OS-discretionary; see [Background behaviour](#background-behaviour).

## What works

- Email/password sign-in against `core`, with refresh-token rotation
  (single-flight and cross-isolate locked) and secure token storage.
- Camera-roll discovery with PhotoKit / MediaStore, change notifications, and
  limited-access handling.
- Durable drift queue: state, hashes, spool paths, session ids, and part
  receipts are persisted **before** each network attempt, so a killed app
  resumes without re-hashing or re-sending acknowledged parts.
- Streaming SHA-256 over the exact bytes that get uploaded. No transcode,
  resize, or re-export.
- Batch dedup pre-check (`POST /api/v1/files/exists`), with an extra guard for
  pre-existing file records that have no asset yet.
- Uploads ≤ 8 MiB (one session part) use multipart `POST /api/v1/files`; larger files use the
  resumable `/api/v1/uploads` session API (8 MiB parts) and resume from server
  status. A 409 duplicate means "already backed up", not a retry.
- Retry policy: exponential backoff + jitter, capped at 15 minutes, honouring
  `Retry-After`; network/408/429/5xx retry, 400/404/413/422 fail permanently
  (413 is recorded as `skippedQuota`).
- Background registration through WorkManager (Android periodic) and
  BGTaskScheduler (iOS refresh + processing). App-open/resume always starts a
  foreground pass and is the guaranteed sync path.
- Queue stats, last-sync summary, permission/banner states, and backup settings
  (Wi-Fi only, charging only, include videos).
- On-device library grid with a per-tile backup badge, multi-select → "Back up
  now", and a full-screen viewer. Videos play in the viewer through the
  platform's own player (`video_player`): tap to play/pause, scrub the timeline,
  keep the screen awake while playing, pause when the app goes to the
  background. The playhead is remembered per asset for the session, so a clip
  left half-watched resumes where it stopped. An iCloud-only video reports its
  download progress first (`photo_manager` progress handler).

## Default scope

- **Camera album by default.** The pipeline scans the camera album (DCIM/Camera
  on Android, Recents on iOS) unless a folder selection is stored; Settings →
  Folders can pick specific albums or turn on "All folders" (`uploadAllFolders`).
  If the platform exposes no recognisable camera album, or the album listing
  fails, the pass falls back to the whole library rather than scanning nothing.
  Selected albums are deduped by asset id, since a photo can live in several.
- **Photos only by default.** Videos are opt-in in Settings
  (`includeVideos: false`).
- The first pass reads the whole library, pre-existing assets included; there is
  no switch to start "from now on".
- Wi-Fi only is on by default (`wifiOnly: true`); charging-only is off. The
  background worker gets this from the OS (WorkManager `Constraints`); every
  foreground/resume pass re-checks the link itself (`NetworkStatus`) and stops
  before uploading when it is metered — discovery still runs, uploads wait.
- Backups can be paused from the home screen (`AppSettings.paused`); a paused
  pass holds before scanning and between assets, in foreground and background
  alike, until the user resumes.
- RAW/DNG/TIFF/MKV and other formats the core rejects are filtered client-side
  before they reach the wire.

## Commands

```bash
flutter pub get
dart run build_runner build            # after editing lib/upload/database.dart
dart run build_runner build --only-check   # presubmit: fails if database.g.dart is stale
flutter analyze
flutter test                           # unit + widget + smoke
flutter run --dart-define=PHOTOX_API_URL=http://localhost:3000
cd ../.. && pnpm mobile:e2e            # on-device e2e: real containers + Android AVD
```

`pnpm mobile:e2e` needs Docker and the `photox` AVD (override with
`MOBILE_E2E_AVD`), boots the real stack and drives `integration_test/` on the
emulator, which reaches the run's published core port as `10.0.2.2:<port>`.
The emulator is left running and reused by the next run. It is opt-in, never
part of `pnpm verify`, and covers the foreground auth flow plus the upload
pipeline (single vs session, dedup, resume across a restart, unusable tokens) —
see `AGENTS.md` for the details and the `MOBILE_E2E_*` knobs.

Toolchain: Flutter 3.47 stable / Dart 3.13, drift, Dio, Workmanager,
photo_manager, flutter_secure_storage, connectivity_plus. Background work runs
through Workmanager + Dio.

`lib/upload/database.g.dart` is committed. If you edit the drift tables, rerun
codegen and commit the regenerated file.

## Configuration

| Setting | Default | How |
| --- | --- | --- |
| Core API URL | prefilled `http://localhost:3000` | First-launch "Connect your server" screen, and editable on the sign-in screen (persisted in the drift `KeyValues` table); `--dart-define=PHOTOX_API_URL=...` only pre-fills that field |
| Single-upload threshold | 8 MiB | `AppConfig.singleUploadThresholdBytes` (client policy, not a server limit) |
| Session part size | 8 MiB | Fixed by the core upload-session contract |
| Max upload | 4 GiB | Core limit |

Android emulators reach the host at `10.0.2.2`, not `localhost`. Physical
Android devices can use `adb reverse`. A physical iPhone needs a LAN-reachable
core URL.

## Architecture

```text
lib/
  main.dart / app.dart     entry point, MaterialApp shell
  app_services.dart        per-isolate object graph (UI + background variants)
  app_controller.dart      UI state, app-open/resume sync, settings actions
  core/                    config, auth manager, token stores, refresh lock, Dio API client
  media/                   PhotoKit/MediaStore observer, media filters, streaming SHA-256
  upload/                  drift queue (source of truth), wire models, session client, uploader
  background/              scheduler + Workmanager callback entrypoint
  sync/                    discovery + upload pass coordinator
  settings/ · ui/          persisted preferences and screens
```

Flow:

```text
observe → enqueue in drift → spool exact bytes + hash → dedup pre-check
        → single POST /api/v1/files (≤8 MiB)
          or create /api/v1/uploads session → PUT parts → complete
        → mark uploaded (or duplicate/skipped/failed)
```

The drift database is authoritative for resume decisions. Tokens are stored in
the platform keystore; refresh rotation is serialized across isolates with a
drift-backed lock, and so is the sync pass itself — the UI isolate and the
Workmanager isolate can never run two passes over the same queue.

## Background behaviour

- Background backup is **best-effort** on both platforms. iOS BGProcessing /
  BGAppRefresh and Android WorkManager windows are chosen by the OS and may be
  deferred, shortened, or killed.
- **Every app open and resume runs a sync pass**, and that path is guaranteed
  while the app is in the foreground.
- Force-quitting the app stops background execution until the user reopens it.
  No location or always-on-service tricks are used.
- Large uploads converge across multiple windows because the queue persists
  part receipts; the app resumes instead of restarting from byte zero.
- Background execution can only be validated on physical devices; there is no
  harness for it — verify by hand against a running core.

## Tests

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit | `flutter test test/unit` | Auth/refresh, queue, hashing, filters, retry, scheduler, coordinator, uploader, settings |
| Widget | `flutter test test/widget` | Login/home/settings shell rendering and interactions |
| Smoke | `flutter test test/smoke_test.dart` | App starts and renders its app bar |
| Device | manual | Real OS background scheduling, permissions, Doze/Low Power, force-quit |

`flutter test` is green without a server. Green unit/widget tests do not
exercise real uploads — only a device does.

## Known limitations

- **No notifications.** Nothing displays upload progress today; Android would
  also need `POST_NOTIFICATIONS`.
- **No Android foreground service.** Long uploads rely on a background window
  or the app staying open.
- **iOS limited-library access** only exposes assets the user selected in the
  Photos picker; the rest are invisible by design.
- **Force-quit stops background work** on both platforms until the next manual
  open.
- **Background execution is device-only**; simulators/emulators cannot validate
  it.
- Single/part uploads are tied to the core's current API. The resumable
  `/api/v1/uploads` session API is live in core; check `apps/core` before
  assuming future surface changes.
- No CI or pre-commit hook: `pnpm mobile:verify` (analyze + test + codegen
  check) is the whole gate.
