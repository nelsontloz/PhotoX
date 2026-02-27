# PhotoX Personal Edition - Current Implementation Status

This document tracks what is implemented now in this repository and running stack.

Last verified: 2026-02-18 (local compose stack)

Source of truth used for this snapshot:
- service route code under `services/*` and `apps/web`
- live OpenAPI specs from `http://localhost:8088/api/v1/<domain>/openapi.json`

---

## Status Legend

- `implemented`: production route behavior exists for core contract endpoints.
- `partial`: some contract behavior exists, but key endpoints are still missing.
- `scaffold-only`: health/metrics/docs scaffolding exists; domain API behavior not implemented yet.

---

## Phase Plan (Current)

- `P0`: environment baseline
- `P1`: auth + upload backend skeleton (implemented)
- `P2`: web auth + upload UI (`/register`, `/login`, `/upload`) (implemented)
- `P3`: timeline core (implemented)
- `P3.1`: multi-file web upload UX (4 concurrent, continue-on-error) (implemented)
- `P3.2`: upload dedupe by owner checksum against active media (implemented)
- `P3.3`: timeline modal high-resolution viewer with next/previous navigation (implemented)
- `P4`: admin user management (in progress)
- `P+1`: albums and sharing (implemented — album CRUD, item membership, selection on timeline)
- `P5`: search and semantic retrieval (planned)
- `P6`: faces, memories, and hardening (planned)
- `P100`: deferred security tech debt (planned)

---

## Service Snapshot

### auth-service - implemented

Implemented now:
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/me`
- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users`
- `PATCH /api/v1/admin/users/{userId}`
- `POST /api/v1/admin/users/{userId}/reset-password`
- `DELETE /api/v1/admin/users/{userId}`
- `GET /api/v1/auth/docs`
- `GET /api/v1/auth/openapi.json`

Notes:
- OpenAPI includes endpoint summaries/descriptions, request examples for write endpoints, response examples, and bearer auth security metadata.
- Integration tests cover register/login/refresh/logout/me and docs/openapi availability.
- First registered user is automatically admin; subsequent self-registered users are non-admin by default.
- Registration admin-bootstrap logic now executes within a single dedicated DB client transaction (`BEGIN`/advisory lock/insert/`COMMIT`) to preserve transactional isolation under concurrent sign-ups.
- Admins can manage user role/status and password reset, with protection against self-demotion and last-active-admin lockout.

Planned/pending:
- `PATCH /api/v1/me`

### ingest-service - implemented

Implemented now:
- `POST /api/v1/uploads/init`
- `POST /api/v1/uploads/{uploadId}/part`
- `POST /api/v1/uploads/{uploadId}/complete`
- `POST /api/v1/uploads/{uploadId}/abort`
- `GET /api/v1/uploads/{uploadId}`
- `GET /health`
- `GET /metrics`
- `GET /api/v1/uploads/docs`
- `GET /api/v1/uploads/openapi.json`

Notes:
- Uses raw `application/octet-stream` chunk upload with `partNumber` query param.
- Persists media relative path and enqueues `media.process` BullMQ job on complete.
- Upload accepts both image and video media types.
- Upload init enforces supported extension/content-type pairs only.
- Upload complete performs server-side signature sniffing and rejects mismatched/unsupported bytes with `UNSUPPORTED_MEDIA_TYPE`.
- Supports `Idempotency-Key` on `init` and `complete`.
- `complete` deduplicates repeated uploads for the same owner and checksum against active media and returns
  `deduplicated=true` when reusing an existing `mediaId`.
- Soft-deleted media are excluded from dedupe matching; uploading the same content after soft delete creates
  a new media item.
- New media rows are created with `status=processing` and are transitioned by worker-side derivative processing.

### library-service - implemented

Implemented now:
- `GET /health`
- `GET /metrics`
- `GET /api/v1/library/docs`
- `GET /api/v1/library/openapi.json`
- `GET /api/v1/library/timeline`
- `GET /api/v1/library/trash`
- `DELETE /api/v1/library/trash`
- `GET /api/v1/library/trash/{mediaId}/preview?variant=thumb|small`
- `GET /api/v1/media/{mediaId}`
- `PATCH /api/v1/media/{mediaId}`
- `DELETE /api/v1/media/{mediaId}`
- `POST /api/v1/media/{mediaId}/restore`
- `GET /api/v1/media/{mediaId}/content?variant=original|thumb|small|playback`

Notes:
- Timeline supports stable cursor pagination, date range filters, flags filters, and text query over media path.
- Timeline and media detail payloads include derivative URLs for `thumb`, `small`, and `original` media content.
- `thumb` and `small` derivatives are served from derived storage as WebP files when present.
- If a requested derivative is missing, library-service enqueues `media.derivatives.generate` and immediately serves source media bytes while the worker generates derivatives.
- Video media support `playback` content variant, which serves derived `video/webm` (VP9/Opus).
- If `playback` is requested before the derived artifact exists, library-service enqueues derivative generation and returns retriable `503 PLAYBACK_DERIVATIVE_NOT_READY`.
- Timeline responses include additive `metadataPreview` fields (`durationSec`, `codec`, `fps`, `width`, `height`).
- Media detail responses include additive `metadata` fields for capture/image/video/location/raw metadata.
- Soft delete now persists `media_flags.deleted_soft_at`, queues delayed `media.cleanup` hard-delete jobs (+30 days), and leaves album memberships intact for restore.
- Empty Trash (`DELETE /api/v1/library/trash`) queues immediate `media.cleanup` jobs for all caller-owned trashed items.
- Trash preview endpoint serves existing derived previews for soft-deleted items without exposing originals or enqueuing derivative generation.

Planned/pending:
- `albumId` and `personId` timeline filters (deferred to P4/P6 relation wiring)

### album-sharing-service - implemented

Implemented now:
- `GET /health`
- `GET /metrics`
- `GET /api/v1/albums/docs`
- `GET /api/v1/albums/openapi.json`
- `POST /api/v1/albums` — create album (returns `mediaCount: 0`)
- `GET /api/v1/albums` — list albums owned by authenticated user (with `mediaCount` via LEFT JOIN and up to 4 `sampleMediaIds` for collage thumbnails)
- `GET /api/v1/albums/:albumId` — get album detail with `mediaCount`
- `POST /api/v1/albums/:albumId/items` — add a media item to an album
- `GET /api/v1/albums/:albumId/items` — list album items (includes `mimeType` per item for media-aware rendering)
- `DELETE /api/v1/albums/:albumId/items/:mediaId` — remove a media item from an album

Notes:
- All endpoints require bearer auth (JWT validated via `requireAuth`).
- Ownership is enforced on all album mutations; non-owners receive 403.
- `addMediaToAlbum` validates that the media exists and belongs to the requesting user (`status = 'ready'`).
- `album_items` uses `ON CONFLICT DO NOTHING` for idempotent adds.
- `mediaCount` is computed via `COUNT(album_items.media_id)` in the same query using `LEFT JOIN`.

Planned/pending:
- sharing endpoints for links, invites, and family access

### search-service - scaffold-only

Implemented now:
- `GET /health`
- `GET /metrics`
- `GET /api/v1/search/docs`
- `GET /api/v1/search/openapi.json`

Planned/pending:
- `GET /api/v1/search`
- `POST /api/v1/search/semantic`
- `POST /api/v1/search/reindex/{mediaId}`

### worker-service - partial

Implemented now:
- `GET /health`
- `GET /metrics`
- `GET /api/v1/worker/docs`
- `GET /api/v1/worker/openapi.json`
- `GET /api/v1/worker/telemetry/snapshot` (admin-only)
- `GET /api/v1/worker/telemetry/stream` (SSE, admin-only)
- BullMQ consumer for `media.derivatives.generate` that creates image `thumb`/`small` WebP derivatives and video `playback` WebM (VP9/Opus) derivatives
 - BullMQ consumer for `media.process` that extracts photo/video metadata, persists `media_metadata`, and generates derivatives for new uploads
- BullMQ consumer for `media.cleanup` that verifies media is still soft-deleted, deletes original/derived files, and hard-deletes DB rows in a transaction.
- After successful derivative generation, worker updates `media.status` from `processing` to `ready`.
- On terminal derivative-processing failure (retry attempts exhausted), worker updates `media.status` to `failed` only when status is still `processing`.
- Worker uses a per-media advisory lock to serialize concurrent `media.process` / `media.derivatives.generate` execution for the same media ID.
- Lock acquisition is non-blocking (`pg_try_advisory_lock`) with bounded retry/backoff; if contention persists, the job fails with a retriable lock-unavailable error and is retried by BullMQ policy.
- Worker telemetry tracks lifecycle events (`active`, `completed`, `failed`, `stalled`, `error`) with bounded in-memory retention and queue depth polling.
- `/metrics` now includes worker job counters, active gauges, queue depth gauges, and duration histogram series.
- Pact consumer/provider coverage includes worker telemetry contracts for `/api/v1/worker/telemetry/snapshot` and `/api/v1/worker/telemetry/stream`.
- EXIF-based capture date extraction for images: worker parses the raw EXIF IFD buffer from `sharp` (via `exif-reader`) in `metadata.js`. `DateTimeOriginal` and other EXIF IFD date fields are used for `taken_at` / `sort_at`; falls back to upload timestamp when no EXIF date is found. Videos use `creation_time` from ffprobe format tags. `media.sort_at` reflects the actual capture date so the timeline sorts photos by when they were taken, not uploaded.


Planned/pending:
- worker processors for metadata, search index, and face index

### ml-service - partial

Implemented now:
- `GET /`
- `GET /health`
- `GET /metrics`
- `GET /api/v1/ml/docs`
- `GET /api/v1/ml/openapi.json`

Planned/pending:
- `POST /api/v1/ml/faces/detect`
- `POST /api/v1/ml/faces/embed`
- `POST /api/v1/ml/faces/cluster`

### web-app - implemented

Implemented now:
- `GET /` redirects unauthenticated users to `/login` and authenticated users to `/timeline`
- `GET /health`
- `GET /register`
- `GET /login`
- `GET /upload`
- `GET /timeline`
- `GET /albums`
- `GET /albums/[id]`
- `GET /trash`

Notes:
- Tailwind CSS baseline added for web UI styling.
- TanStack Query is used for auth and upload interaction state.
- Login persists access/refresh token pair in client session storage.
- Authenticated users visiting `/login` or `/register` are redirected to `/timeline`.
- Successful registration redirects to `/timeline` by default.
- Upload page validates authenticated session with `/api/v1/me`, performs chunked upload
  (`init` -> `part` -> `complete`), renders progress, and shows API envelope errors.
- Upload page supports multi-file batch uploads with bounded concurrency of 4, per-file progress/status,
  aggregate progress, and continue-on-error behavior.
- Timeline page fetches cursor-paginated media from `/api/v1/library/timeline` and renders authenticated
  thumbnail previews via `/api/v1/media/{mediaId}/content?variant=thumb`. Timeline uses a horizontal flexbox-based grid to ensure chronological sorting.
- Timeline thumbnail cards show an explicit loading spinner while `thumb` derivatives are being generated.
- Clicking a timeline photo opens a modal viewer that loads authenticated high-resolution (`variant=small`) media,
  supports close/escape, previous/next navigation, and auto-loads more timeline items when navigating past the
  last loaded card and additional pages are available.
- Video timeline items load authenticated playback blobs from `/api/v1/media/{mediaId}/content?variant=playback`.
- Modal viewer shows explicit loading spinners while `small` image or `playback` video derivatives are being
  prepared, and playback requests that return retriable derivative-not-ready errors are polled with bounded retries.
- Top bar is session-aware: authenticated users see account email and logout, and admin users additionally see
  an admin button.
- Sidebar navigation includes only implemented routes (`/timeline`, `/upload`, `/albums`) plus `/admin` for admins.
- Sidebar navigation includes `/trash` for all authenticated users.
- Trash page lists soft-deleted media with restore actions and explicit Empty Trash confirmation.
- Trash page renders authenticated thumbnail previews when derived preview artifacts are available.
- Media lightbox now supports deleting media to Trash from Timeline and Album detail flows and invalidates timeline/album/trash queries.
- Admin page consumes worker telemetry snapshot + SSE stream with reconnect and polling fallback, and surfaces a worker backlog metric with stream health state.
- Timeline supports multi-select mode: a "Select" toggle enables per-photo selection with visible checkmarks. A floating bottom bar shows selected count, "Delete" on the left, and a "Add to Album" primary button on the right. Labels are responsive (icons only on mobile).
- Created a global `ConfirmationModal` component for premium confirmation dialogs, replacing native browser confirms. Used for bulk deletion on the timeline.
- `AssignToAlbumModal` lets users add selected photos to an existing album or create a new one inline,
  using `Promise.allSettled` for batch add with per-item success/error reporting.
- Albums page (`/albums`) lists the user's real albums (with `mediaCount`), with a "Create Album" modal.
- Album detail page (`/albums/[id]`) shows album photos in a masonry grid; hovering a photo reveals
  a remove button (`DELETE /albums/:albumId/items/:mediaId`); an "Add Photos" link navigates to `/timeline`.

Planned/pending:
- `/search`, `/people`, `/memories` feature UIs (current routes return not-found placeholders)

### P100 security tech debt snapshot - planned

Deferred from audit triage:
- Browser token storage migration (`P100-S1`): web app currently persists access/refresh token pair in browser storage and needs migration to secure cookie-based session transport.
- Production secret hard-fail policy (`P100-S2`): auth, ingest, and library services still allow insecure JWT defaults in non-hardened startup paths and require production-mode fail-fast enforcement.

Tracking source:
- Task contracts and acceptance criteria: `docs/07-ai-agent-task-contracts.md`.
- Checklist gates: `docs/10-execution-checklists-and-handoffs.md`.

---

## Runtime Verification Commands

Use these commands to refresh this snapshot:

```bash
docker compose --env-file .env --profile app ps

python3 - <<'PY'
import json, urllib.request
for service in ['auth','uploads','library','albums','search','worker','ml']:
    url = f'http://localhost:8088/api/v1/{service}/openapi.json'
    spec = json.load(urllib.request.urlopen(url, timeout=5))
    print(service, sorted(spec.get('paths', {}).keys()))
PY

npm --prefix apps/web test
npm --prefix services/worker test
npm --prefix services/auth test
npm --prefix services/ingest test
npm --prefix services/library test
```
