# PhotoX Mobile

iOS + Android app that automatically backs up device photos and videos to a self-hosted PhotoX server (sibling repo `../PhotoX`).

**Status: scaffold** — module skeleton only (stubs, no upload logic yet).

## Target behaviour

- Watches the system photo library and uploads new photos/videos automatically.
- Background backup is best-effort by OS policy (iOS BGProcessing is discretionary; force-quit stops everything until the app is reopened). Every app open/resume runs a fast, correct sync pass — that is the guaranteed path.
- Large videos upload as resumable parts, so a multi-GB file converges across many short background windows instead of restarting from zero.

## Stack

Flutter 3.47 stable / Dart 3.13 · Material 3 · dark theme by default

- `photo_manager` — library enumeration + change notifications (limited/partial access handled)
- `drift` (+ `drift_flutter`) — local SQLite upload queue
- `background_downloader` — native background transfers (iOS background URLSession / Android WorkManager)
- `workmanager` — background task registration and scheduling
- `dio` — foreground HTTP · `crypto` — streaming SHA-256 · `flutter_secure_storage` — token storage

## Getting started

Prerequisites:

- Flutter 3.47+ (`brew install --cask flutter`)
- iOS: full Xcode + CocoaPods (not yet installed on this machine)
- Android: Android SDK / command-line tools (not yet installed)

```bash
flutter pub get
dart run build_runner build      # drift codegen (after editing database.dart)
flutter analyze                  # must be clean
flutter test
flutter run --dart-define=PHOTOX_API_URL=http://localhost:3000
```

## Architecture

```
lib/
  main.dart / app.dart    app entry, MaterialApp (dark by default)
  core/        config constants, auth (Bearer + single-flight refresh), dio API client
  media/       photo observer (PhotoKit / MediaStore), streaming SHA-256 hasher
  upload/      drift queue + models, session client, dual-path uploader
  background/  scheduler + worker entrypoint
  settings/ · ui/   settings store and placeholder screens
```

Flow: `PhotoObserver → UploadQueue (SQLite) → Hasher → dedup pre-check → Uploader`
(single `POST /api/v1/files` ≤ 64 MiB, else part-based `/api/v1/uploads` sessions) `→ complete → done`.

The server API contract and the rules agents must follow live in [AGENTS.md](AGENTS.md).

## Roadmap

- **M0** — toolchain + on-device spikes (background transport, hash throughput)
- **M1** — server: upload-sessions API + auth hardening (in the PhotoX repo)
- **M2** — app core: auth, queue, hashing, dedup pre-check, foreground uploads
- **M3** — background scheduling, notifications, initial-sync mode
- **M4** — polish + distribution
