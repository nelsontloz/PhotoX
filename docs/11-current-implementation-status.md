# PhotoX Personal Edition - Current Implementation Status

This document tracks what is implemented now in this repository and running stack.

Last verified: 2026-02-16 (local compose stack)

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
- `P4`: albums and sharing (planned)
- `P5`: search and semantic retrieval (planned)
- `P6`: faces, memories, and hardening (planned)

---

## Service Snapshot

### auth-service - implemented

Implemented now:
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/me`
- `GET /api/v1/auth/docs`
- `GET /api/v1/auth/openapi.json`

Notes:
- OpenAPI includes endpoint summaries/descriptions, request examples for write endpoints, response examples, and bearer auth security metadata.
- Integration tests cover register/login/refresh/logout/me and docs/openapi availability.

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
- Supports `Idempotency-Key` on `init` and `complete`.

### library-service - implemented

Implemented now:
- `GET /health`
- `GET /metrics`
- `GET /api/v1/library/docs`
- `GET /api/v1/library/openapi.json`
- `GET /api/v1/library/timeline`
- `GET /api/v1/media/{mediaId}`
- `PATCH /api/v1/media/{mediaId}`
- `DELETE /api/v1/media/{mediaId}`
- `POST /api/v1/media/{mediaId}/restore`
- `GET /api/v1/media/{mediaId}/content?variant=original|thumb|small`

Notes:
- Timeline supports stable cursor pagination, date range filters, flags filters, and text query over media path.
- Timeline and media detail payloads include derivative URLs for `thumb`, `small`, and `original` media content.
- `thumb` and `small` derivatives are generated on demand as WebP files by library-service.

Planned/pending:
- `albumId` and `personId` timeline filters (deferred to P4/P6 relation wiring)

### album-sharing-service - scaffold-only

Implemented now:
- `GET /health`
- `GET /metrics`
- `GET /api/v1/albums/docs`
- `GET /api/v1/albums/openapi.json`

Planned/pending:
- album CRUD and item membership endpoints
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

### worker-service - scaffold-only

Implemented now:
- `GET /health`
- `GET /metrics`
- `GET /api/v1/worker/docs`
- `GET /api/v1/worker/openapi.json`

Planned/pending:
- worker processors for media pipeline jobs (`media.process`, metadata, derivatives, search index, face index, cleanup)

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
- `GET /` renders P3 web shell with links to auth, upload, and timeline flows
- `GET /health`
- `GET /register`
- `GET /login`
- `GET /upload`
- `GET /timeline`

Notes:
- Tailwind CSS baseline added for web UI styling.
- TanStack Query is used for auth and upload interaction state.
- Login persists access/refresh token pair in client session storage.
- Upload page validates authenticated session with `/api/v1/me`, performs chunked upload
  (`init` -> `part` -> `complete`), renders progress, and shows API envelope errors.
- Timeline page fetches cursor-paginated media from `/api/v1/library/timeline` and renders authenticated
  thumbnail previews via `/api/v1/media/{mediaId}/content?variant=thumb`.

Planned/pending:
- `/albums`, `/search`, `/people`, `/memories` feature UIs

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
```
