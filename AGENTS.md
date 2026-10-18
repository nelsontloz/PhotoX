# PhotoX Mobile — Agent Notes

iOS + Android app that automatically backs up device photos and videos to a self-hosted PhotoX server (sibling repo `../PhotoX`, NestJS core — the only HTTP API). This repo is Flutter; it talks to core directly with Bearer JWTs. There is no other backend.

Status: skeleton (stubs + docs only). The full architecture spec lives in the PhotoX workspace conversation; `TODO(spec §x)` comments in code map to it. The operative contract is repeated below — keep the two in sync.

## Layout

- `lib/core/` — `app_config.dart` (64 MiB single-POST threshold, 5–64 MiB parts, 60 s refresh grace), `auth_manager.dart`, `api_client.dart`
- `lib/media/` — `photo_observer.dart` (PhotoKit / MediaStore), `hasher.dart` (SHA-256 of the exact bytes uploaded)
- `lib/upload/` — `models.dart` (states, protocol, session result types), `database.dart` (drift queue; generated `database.g.dart` is tracked), `upload_queue.dart`, `session_client.dart`, `uploader.dart`
- `lib/background/` — `scheduler.dart`, `worker.dart` (`callbackDispatcher`)
- `lib/settings/`, `lib/ui/` — settings store + placeholder screens

Flow: observe → enqueue (drift) → hash → dedup pre-check → upload (single POST ≤ 64 MiB; else session parts) → complete → mark uploaded.

## Toolchain

- Flutter 3.47.x stable (Homebrew cask, `/opt/homebrew/bin/flutter`), Dart 3.13; Material 3, dark default.
- Codegen: after editing `database.dart`, run `dart run build_runner build` (`--delete-conflicting-outputs` is a no-op on build_runner 2.16).
- `flutter analyze` and `flutter test` must be green before any commit.
- Device runs: full Xcode + CocoaPods (iOS) and the Android SDK are NOT installed on the dev Mac yet. Simulators are insufficient for background behaviour — use real devices; test BGTask wakes with Xcode `_simulateLaunchForTaskWithIdentifier`.

## Server contract (must match PhotoX core)

- Auth: `POST /api/v1/auth/login|refresh|logout` return the token pair in the JSON body — cookies are irrelevant for this client. Bearer is accepted on every route. Refresh once, single-flight, on 401; rotation has a 60 s grace window server-side, so a lost response must never log out every device. Never refresh in parallel.
- Upload paths:
  - ≤ 64 MiB: `POST /api/v1/files` (multipart field `file`).
  - Larger: resumable sessions —
    - `POST /api/v1/uploads` `{checksumSha256, sizeBytes, filename, takenAt?, title?, description?, partSize?}` → 201 `{uploadId, partSize, partCount, expiresAt}` **or 200 duplicate (success, never an error)**
    - `GET /api/v1/uploads/:id` → status + `receivedParts`
    - `PUT /api/v1/uploads/:id/parts/:index` — raw bytes, exact expected length, idempotent re-PUT
    - `POST /api/v1/uploads/:id/complete` → 201 Asset (idempotent replay returns the same); 409 `missingParts`, 422 checksum, 413 quota, 410 expired
    - `DELETE /api/v1/uploads/:id` — abort
- Dedup: SHA-256 of the exact uploaded bytes + `POST /api/v1/files/exists` batch pre-check (≤ 100 items). Duplicate = mark done.
- Server-side type sniff is the authority: JPEG/PNG/GIF/WebP/HEIC/HEIF/AVIF/MOV/MP4/WebM/AVI only. RAW/DNG/TIFF/MKV are rejected — filter client-side with a clear per-asset state.

## Rules

- Never transcode, resize, or re-export before hashing/uploading. Hash and upload the same bytes (Immich #29543: hash/upload mismatch caused re-upload loops).
- Background is opportunistic: iOS force-quit cancels everything until manual reopen; Android force-stop and OEM killers behave the same. **Resume-on-app-open is the guaranteed path; every open/resume runs a sync pass.**
- iOS: BGProcessingTask (network; external power when charging-only) + BGAppRefreshTask, reschedule-first; transfers are file-based background `URLSession` tasks, one per part. Android: 15-min periodic WorkManager + MediaStore content-URI trigger one-shot + user-initiated transfer for manual sync; foreground service only as an explicit user opt-in.
- No location-services wake hacks, no always-on services, no dependence on push (APNs/FCM out of scope).
- Persist queue state and part receipts BEFORE each network attempt; a killed process must resume without re-hashing or re-sending acknowledged parts.
- Error taxonomy: retryable = network/408/429/5xx/503; permanent = 400/404/413/422 (413 → skippedQuota, 422 → fail once). Exponential backoff + jitter, cap 15 min, honour `Retry-After`.
- UX defaults: Wi-Fi-only ON, charging-only option, album selection with exclusions, visible queue, "keep app open" initial-sync mode.

## Style

- `dart format`, flutter_lints; snake_case files, PascalCase types; keep files small.
- Mark deliberate simplifications with `ponytail:` (ceiling + upgrade path) — same convention as PhotoX.
- No new dependencies without updating this file and the README.
