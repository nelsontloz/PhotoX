# PhotoX Mobile

iOS + Android app that backs up the device camera roll to a self-hosted
[PhotoX](../PhotoX) server. Flutter, Material 3, dark theme by default.

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
- Uploads ≤ 64 MiB use multipart `POST /api/v1/files`; larger files use the
  resumable `/api/v1/uploads` session API (8 MiB parts) and resume from server
  status. A 409 duplicate means "already backed up", not a retry.
- Retry policy: exponential backoff + jitter, capped at 15 minutes, honouring
  `Retry-After`; network/408/429/5xx retry, 400/404/413/422 fail permanently
  (413 is recorded as `skippedQuota`).
- Background registration through WorkManager (Android periodic; a one-off API
  exists but is not wired to the UI) and BGTaskScheduler (iOS refresh +
  processing). App-open/resume always starts a foreground pass and is the
  guaranteed sync path.
- Queue stats, last-sync summary, permission/banner states, and backup settings
  (Wi-Fi only, charging only, include videos, backfill, notifications toggle).

## Default scope

- **Camera roll only** (`source: cameraRoll`); other albums are not scanned.
- **Photos only by default.** Videos are opt-in in Settings
  (`includeVideos: false`).
- Backfill of pre-existing assets is on by default (`backfill: true`).
- Wi-Fi only is on by default (`wifiOnly: true`); charging-only is off.
- RAW/DNG/TIFF/MKV and other formats the core rejects are filtered client-side
  before they reach the wire.

## Commands

```bash
flutter pub get
dart run build_runner build            # after editing lib/upload/database.dart
dart run build_runner build --only-check   # presubmit: fails if database.g.dart is stale
flutter analyze
flutter test                           # unit + widget + smoke; live contract group skips
flutter run --dart-define=PHOTOX_API_URL=http://localhost:3000
```

Toolchain: Flutter 3.47 stable / Dart 3.13, drift, Dio, Workmanager,
photo_manager, flutter_secure_storage. (`background_downloader` is declared
for a possible native-transfer path but is not used yet; background work runs
through Workmanager + Dio.)

`lib/upload/database.g.dart` is committed. If you edit the drift tables, rerun
codegen and commit the regenerated file.

## Configuration

| Setting | Default | How |
| --- | --- | --- |
| Core API URL | `http://localhost:3000` | `--dart-define=PHOTOX_API_URL=...` |
| Single-upload threshold | 64 MiB | `AppConfig.singleUploadThresholdBytes` (client policy, not a server limit) |
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
        → single POST /api/v1/files (≤64 MiB)
          or create /api/v1/uploads session → PUT parts → complete
        → mark uploaded (or duplicate/skipped/failed)
```

The drift database is authoritative for resume decisions. Tokens are stored in
the platform keystore; refresh rotation is serialized across isolates with a
drift-backed lock.

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
- Background execution can only be validated on physical devices. Commands and
  a B1–B12 checklist live in
  [tool/e2e/device_background.md](tool/e2e/device_background.md).

## Tests

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit | `flutter test test/unit` | Auth/refresh, queue, hashing, filters, retry, scheduler, coordinator, uploader, settings |
| Widget | `flutter test test/widget` | Login/home/settings shell rendering and interactions |
| Smoke | `flutter test test/smoke_test.dart` | App starts and renders its app bar |
| Contract | `tool/e2e/run_contract.sh` | Live core: register/login, session lifecycle, dedup, 409 duplicate, refresh |
| Device | manual | Real OS background scheduling, permissions, Doze/Low Power, force-quit |

`flutter test` is green without a server: the contract group skips when
`PHOTOX_E2E_BASE_URL` is unset. Green unit/widget tests do not exercise real
uploads — use the contract suite and a device for that.

Live contract suite directly against an already-running core:

```bash
PHOTOX_E2E_BASE_URL=http://127.0.0.1:3917 flutter test test/contract
```

## e2e stack

The mobile repo drives the PhotoX Compose e2e stack from the sibling checkout:

```bash
tool/e2e/stack_up.sh        # start core + infra, publish core on 127.0.0.1
tool/e2e/stack_down.sh      # stop and remove volumes (idempotent)
tool/e2e/run_contract.sh    # up → wait for /health → contract tests → down -v
```

See [tool/e2e/README.md](tool/e2e/README.md) for prerequisites, ports, env
vars, seeding, artifacts, and limitations. `E2E_BUILD=1` rebuilds the images;
`E2E_KEEP=1` leaves the stack running after the contract run.

Requires Docker, Flutter, and the sibling `../PhotoX` repo (or `PHOTOX_DIR`).

## Known limitations

- **No notifications.** The settings toggle is persisted for a future notifier;
  nothing displays upload progress today. Android would also need
  `POST_NOTIFICATIONS`.
- **No Android foreground service.** Long uploads rely on a background window
  or the app staying open.
- **iOS limited-library access** only exposes assets the user selected in the
  Photos picker; the rest are invisible by design.
- **Force-quit stops background work** on both platforms until the next manual
  open.
- **Background execution is device-only**; simulators/emulators cannot validate
  it.
- Single/part uploads are tied to the core's current API. The resumable
  `/api/v1/uploads` session API is live in core; check the sibling repo before
  assuming future surface changes.
- No CI or pre-commit hook: `flutter analyze && flutter test` plus the contract
  stack is the whole gate.
