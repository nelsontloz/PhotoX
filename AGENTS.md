# PhotoX Mobile — Agent Notes

Flutter (iOS + Android) client that backs up the device photo library to the sibling repo `../PhotoX` (NestJS `core`, the only HTTP API — no other backend). Talks to it directly with Bearer JWTs.

**Status: the pipeline is implemented** — discovery, hashing, drift queue, dedup, upload/resume, auth refresh — with unit and widget suites under `test/`. What is *not* verified is anything the OS owns: real background execution, PhotoKit/MediaStore edge cases, per-device behaviour. Those need a phone; an emulator proves nothing. `TODO(spec §x)` comments map to an architecture spec that lives outside this repo — keep the numbering when adding TODOs.

**UI status:** one signed-in shell with two tabs — **Library** (on-device library grid, per-tile backup badges, selection → "Back up now") and **Backup** (the sync dashboard). The Library tab is the landing screen; Settings is a pushed route from either. The grid reads the *device*, never the server: a badge means "this phone uploaded those bytes", so an asset uploaded from another device reads "not backed up" until this phone hashes it and dedup answers (see the badge note below).

## Commands

```bash
flutter pub get
dart run build_runner build            # ONLY needed after editing lib/upload/database.dart
dart run build_runner build --only-check   # presubmit: fails if database.g.dart is stale
flutter analyze && flutter test        # the entire gate — there is no CI and no pre-commit
flutter run --dart-define=PHOTOX_API_URL=http://localhost:3000
```

- Toolchain verified: Flutter 3.47.7 stable (`/opt/homebrew/bin/flutter`), Dart 3.13.5, build_runner 2.16.2, drift 2.35.2.
- `--delete-conflicting-outputs` is accepted but ignored on build_runner 2.16 — harmless, never needed.
- `test/smoke_test.dart` only asserts the app bar renders. Green `analyze`/`test` proves nothing about backup logic; real verification needs a device.
- `lib/upload/database.g.dart` is committed, so codegen drift is silent — re-run `--only-check` if you touched the drift tables.
- `PHOTOX_API_URL` only pre-fills the first-launch "Connect your server" screen; the address the app uses is the one persisted in the drift `KeyValues` table (`AppSettings.apiBaseUrl`, emptied = not configured). An Android emulator reaches the host at `10.0.2.2`, not `localhost`.
- `analysis_options.yaml` excludes `build/**`, `android/**`, `ios/**` from analysis.

## Deploy to a device

`adb` is not on `PATH` on the maintainer machine; `flutter doctor -v` prints the SDK root, so:

```bash
export ADB=/opt/homebrew/share/android-commandlinetools/platform-tools/adb
```

### USB

```bash
$ADB devices                       # must say "device", not "unauthorized"
flutter run --dart-define=PHOTOX_API_URL=http://localhost:3000
```

`flutter run` is the only route to hot reload and it needs a tty — do not launch it backgrounded. A plain install + launch, with `flutter attach` for hot reload afterwards:

```bash
flutter build apk --debug
$ADB install -r build/app/outputs/flutter-apk/app-debug.apk
$ADB shell am start -n com.photox.photox_mobile/.MainActivity
flutter attach
```

Hot reload does not re-run `main()` or rebuild `AppServices`, and never touches the Workmanager isolate: use `R` (hot restart) or reinstall for wiring changes.

### Wi-Fi (no cable)

Pairing is one-time. The **pairing** port is not the **connect** port, and the connect port changes every time wireless debugging is toggled:

```bash
$ADB pair <ip>:<pairing-port>      # one time, then the 6-digit code
$ADB mdns services                 # find <ip>:<port> under _adb-tls-connect._tcp
$ADB connect <ip>:<port>
$ADB reverse tcp:3000 tcp:3000     # reverse rides the adb transport, so it works over Wi-Fi too
flutter run -d <ip>:<port> --dart-define=PHOTOX_API_URL=http://localhost:3000
```

- Same subnet as the Mac; guest/isolated Wi-Fi breaks mDNS discovery.
- The link goes stale on phone reboot, network change, or deep sleep — re-run `mdns services` + `connect` (idempotent). `adb reverse` dies with it and must be re-added, or uploads fail with connection errors until the app is restarted.
- Android 16 here has no device-side `curl`/`wget`, so verify reachability from the app, not `adb shell`.

### Gotchas that cost real time

- `--dart-define` only pre-fills the first-launch setup screen: the address in use is `KeyValues.apiBaseUrl` in the drift DB, so an update install keeps the old server. The sign-in screen prefills the same address and is editable — a different value typed there is persisted and retargets both Dio clients, so no reinstall is needed to move servers.
- The e2e override publishes core on **loopback only** (`tool/e2e/docker-compose.mobile.yml`), so the Mac's LAN IP is refused from a phone. Use `adb reverse`, or widen the bind on purpose.
- `adb shell input` fails with `INJECT_EVENTS` until *Developer options → USB debugging (Security settings)* is enabled; without it the UI cannot be driven or scripted from the shell.
- Reading the app's queue DB (debug builds only) — pull the `-wal` too, or recent rows are missing:
  ```bash
  $ADB exec-out run-as com.photox.photox_mobile cat app_flutter/photox_mobile.sqlite > photo.sqlite
  $ADB exec-out run-as com.photox.photox_mobile cat app_flutter/photox_mobile.sqlite-wal > photo.sqlite-wal
  ```
- Screenshots via `adb exec-out screencap -p` contain the user's photos; delete them.

## Platform wiring is missing (not just stubs)

- iOS: no `Podfile` at all (needs full Xcode + CocoaPods), and `ios/Runner/Info.plist` has **no** `UIBackgroundModes`, `BGTaskSchedulerPermittedIdentifiers`, or `NSPhotoLibraryUsageDescription`. Add these keys in the same change that adds BGTask/PhotoKit code.
- Android: `android/app/src/main/AndroidManifest.xml` now declares `INTERNET`, `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`/`READ_MEDIA_VISUAL_USER_SELECTED`, legacy `READ_EXTERNAL_STORAGE` (`maxSdkVersion="32"`), `ACCESS_MEDIA_LOCATION` and `WAKE_LOCK`, so release builds can reach the network and read media. `ACCESS_MEDIA_LOCATION` must stay paired with `mediaLocation: true` in `PhotoManagerObserver.ensurePermission` — without the runtime grant Android 10+ zeroes EXIF GPS in every media read (FUSE included), and the backup uploads location-stripped originals. Still missing for background work: `POST_NOTIFICATIONS`, the foreground-service permissions and their `<service>` declaration — there is no notification or foreground service yet, so a long upload only survives while the OS grants a background window.
- `callbackDispatcher` (`lib/background/worker.dart`) is registered from `main.dart` via `services.scheduler.init(...)` (`WorkmanagerRegistrar` → `Workmanager().initialize`). Registration succeeding is not proof it runs: WorkManager windows can only be observed on real hardware.
- Simulators/emulators cannot validate background execution — device only.
- `wifiOnly`/`chargingOnly` are OS `Constraints` for the WorkManager job only; the pass itself re-checks the link via `NetworkStatus` (`connectivity_plus`) before uploading, so a foreground "Sync now" on mobile data waits instead of uploading. Charging-only has **no** foreground equivalent yet (would need a battery plugin).
- Backup scope defaults to the camera album (`DCIM/Camera`, iOS Recents); `AppSettings.uploadFolderIds` / `uploadAllFolders` override it, and any doubt (no camera album found, `folders()` throws) falls back to scanning the whole library. `PhotoManagerObserver.folders()` memoises the album list for the process (`shortcut:`), so a newly created album shows up only after an app restart.

## Core API — what actually exists

Verified in `../PhotoX/apps/core/src`. Controllers declare `api/v1/...` with no global prefix. Present today:

- `POST /api/v1/files` — multipart field `file` (multer cap 4 GiB). Body may carry `title`, `description`, `takenAt`; `kind` is accepted-but-ignored. `ValidationPipe` is `forbidNonWhitelisted`, so extra body fields 400.
- `POST /api/v1/files/exists` — `{items:[{checksumSha256, sizeBytes?}]}`, max 100 items, checksum must match `^[0-9a-f]{64}$`.
- `GET /api/v1/files/:id` (+ `/stream`, `/download`).
- `POST /api/v1/auth/{register,login,refresh,logout}` — token pair is returned in the JSON body; logout is 204 and idempotent. Refresh rotates the token with reuse detection.

**The resumable `/api/v1/uploads` session API is live** in core (`../PhotoX/apps/core/src/uploads/uploads.controller.ts`): `POST /api/v1/uploads` (create), `GET /api/v1/uploads/:uploadId` (status), `POST /api/v1/uploads/:uploadId/parts/:partIndex` (part), `POST /api/v1/uploads/:uploadId/complete` (409 `missingParts` when incomplete). `SessionClient` matches it and `tool/e2e/run_contract.sh` exercises it against a live stack. The routes were documented before they existed, so still read the controller rather than trusting a remembered shape.

Behaviours an agent would otherwise get wrong:

- The 64 MiB single-POST threshold is a **client** policy (`AppConfig`), not a server limit.
- Re-uploading bytes already stored returns **409 with `{existingAssetId, existingFileId}`** — that is "already backed up": mark done, never retry. (Distinct from the `409 missingParts` the future session API returns from `/complete`.)
- The server sniffs 12 header bytes and rejects anything else with 400 `Unsupported file type`; accepted: jpeg, png, gif, webp, avi, webm, heic, heif, avif, quicktime, mp4. RAW/DNG/TIFF/MKV must be filtered client-side.
- 413 (quota) appears only when `STORAGE_QUOTA_BYTES` is configured, and is checked *after* the dedup fast-path.
- `AuthManager`'s doc comments mention a `deviceId` the "backup API" uses — core has no such field on any auth route. Don't invent one; forbidden non-whitelisted fields 400.

## Design rules the code must keep

- Hash the exact bytes that get uploaded; never transcode, resize, or re-export first. A hash/upload mismatch causes endless re-upload loops.
- Persist queue state and part receipts **before** each network attempt, so a killed process resumes without re-hashing or re-sending acknowledged parts.
- Resume-on-app-open is the guaranteed sync path; background execution is opportunistic on both platforms (force-quit kills it until manual reopen). No location-services wake hacks, no always-on services, no push dependency.
- Auth: refresh once, single-flight; a replayed refresh token revokes the whole token family, so a lost-but-applied refresh must not log every device out and refreshes must never run in parallel.
- Errors: retryable = network/408/429/5xx; permanent = 400/404/413/422 (413 → `skippedQuota`, 422 → fail once). Exponential backoff + jitter, cap 15 min, honour `Retry-After`.
- Library badges are per-device truth, not server truth: `resolveBackupStatus` (`lib/library/backup_status.dart`) maps a `QueuedAssets` row to a badge, and no row means "this phone never queued it". The server has no device-asset identity (only `checksumSha256`), so cross-device ownership can only be proven by hashing. `PhotoObserver.page()` candidates carry `sizeBytes: 0` on purpose — the platform reports no size without exporting bytes — so the queue treats `0` as unknown (`_knownSize`/`_sizeChanged`) and the uploader records the real length after spooling. Anything that reads `QueuedAssets.sizeBytes` must tolerate `0`.

## Layout

`lib/core/` config + auth + dio client · `lib/media/` photo discovery (PhotoKit/MediaStore) + streaming SHA-256 · `lib/library/` backup-badge resolver · `lib/upload/` drift queue (`QueuedAssets`, `UploadParts`, schema v1), wire models, session client, uploader · `lib/background/` scheduler + worker entrypoint · `lib/settings/`, `lib/ui/` (`library_screen.dart` = device grid, `home_screen.dart` = backup dashboard).

Flow: observe → enqueue (drift) → hash → dedup pre-check → upload → complete → mark uploaded. The drift database is the source of truth for resume decisions.

## Style

- `dart format`, flutter_lints; snake_case files, PascalCase types; keep files small.
- Mark deliberate simplifications with `ponytail:` (ceiling + upgrade path) — same convention as PhotoX.
- No new dependencies without updating this file and the README.
