# PhotoX Personal Edition - API Contracts (v1)

## 1) Global Conventions

- Base path: `/api/v1`
- Auth: `Authorization: Bearer <jwt>`
- Content type: `application/json`
- Idempotency for critical writes: `Idempotency-Key` header
- Pagination: cursor-based (`cursor`, `nextCursor`, `limit`)
- Backend API docs are mandatory at `/api/v1/<domain>/docs` and `/api/v1/<domain>/openapi.json`

### Implementation Stack Notes
- TS services (`auth`, `ingest`, `library`, `album-sharing`, `search`) run on Fastify.
- ML service (`ml`) runs on FastAPI.
- Queue contracts are implemented as BullMQ jobs backed by Redis.
- Semantic search uses PostgreSQL + pgvector (no OpenSearch in v1).
- Each service publishes an OpenAPI spec (`/openapi.json`).

### Error Envelope
```json
{
  "error": {
    "code": "string",
    "message": "human readable message",
    "details": {}
  },
  "requestId": "uuid"
}
```

### Contract Compatibility Enforcement

- Consumer/provider compatibility is enforced with `python3 scripts/contract_runner.py --mode all --base-url http://localhost:8088`.
- API contract checks compare consumer-required operations and fields against provider OpenAPI specs.
- Queue contract checks validate required payload keys for async boundaries (starting with ingest -> worker `media.process`).

Compatibility policy:
- Non-breaking:
  - add new endpoints,
  - add optional request/response fields,
  - add new optional queue payload fields.
- Breaking:
  - remove/rename existing consumed endpoint paths or methods,
  - remove/rename required request/response fields used by consumers,
  - change required field types incompatibly,
  - remove required queue payload keys.

Consumer/provider ownership matrix (v1):
- `apps/web` -> `auth-service`: `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/me`.
- `apps/web` -> `ingest-service`: `/api/v1/uploads/init`, `/api/v1/uploads/{uploadId}/part`, `/api/v1/uploads/{uploadId}/complete`.
- `apps/web` -> `library-service`: `/api/v1/library/timeline`, `/api/v1/media/{mediaId}/content`.
- `ingest-service` -> `worker-service` queue: `media.process`.

---

## 2) Auth Service

### Endpoints

Implemented now:
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/refresh`
- `GET /me`
- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/{userId}`
- `POST /admin/users/{userId}/reset-password`
- `DELETE /admin/users/{userId}`
- `GET /auth/docs`
- `GET /auth/openapi.json`

Planned/pending:
- `PATCH /me`

### Auth OpenAPI Documentation Requirements
- Every implemented auth write endpoint must publish request body examples in OpenAPI.
- Each implemented auth endpoint must include summary + description in OpenAPI.
- Authenticated endpoints must include `bearerAuth` security requirement in OpenAPI.

### Sample Register Request
```json
{
  "email": "user@example.com",
  "password": "super-secret-password",
  "name": "Alex Doe"
}
```

### Sample Login Request
```json
{
  "email": "user@example.com",
  "password": "super-secret-password"
}
```

### Sample Login Response
```json
{
  "accessToken": "jwt",
  "refreshToken": "opaque-token",
  "expiresIn": 3600,
  "user": {
    "id": "usr_123",
    "email": "user@example.com",
    "name": "User",
    "isAdmin": false,
    "isActive": true
  }
}
```

### Refresh Request
```json
{
  "refreshToken": "jwt-refresh-token"
}
```

### Logout Request
```json
{
  "refreshToken": "jwt-refresh-token"
}
```

### Sample Auth Error Response
```json
{
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Invalid email or password",
    "details": {}
  },
  "requestId": "req-4xYdA1GspM9n"
}
```

### Me Response
```json
{
  "user": {
    "id": "usr_123",
    "email": "user@example.com",
    "name": null,
    "isAdmin": false,
    "isActive": true
  }
}
```

### Admin User Management (auth service)
- `GET /admin/users?limit=&offset=`
- `POST /admin/users`
- `PATCH /admin/users/{userId}`
- `POST /admin/users/{userId}/reset-password`
- `DELETE /admin/users/{userId}`

Rules:
- First self-registered user is auto-assigned `isAdmin=true`.
- Subsequent self-registered users default to `isAdmin=false`.
- Admins can promote other users to admin.

---

## 3) Ingest Service

### Endpoints
Implemented now:
- `POST /uploads/init`
- `POST /uploads/{uploadId}/part`
- `POST /uploads/{uploadId}/complete`
- `POST /uploads/{uploadId}/abort`
- `GET /uploads/{uploadId}`
- `GET /uploads/docs`
- `GET /uploads/openapi.json`

### Ingest OpenAPI Documentation Requirements
- Implemented write endpoints include request examples and response examples in OpenAPI.
- Authenticated ingest endpoints include `bearerAuth` security metadata in OpenAPI.
- `init` and `complete` support `Idempotency-Key` for safe retries.
- Ingest OpenAPI operation descriptions for `init`/`complete` explicitly state `Idempotency-Key` retry support.
- `complete` performs owner-scoped checksum dedupe against active media.
- Upload `contentType` supports both image and video media types.

### Init Request
```json
{
  "fileName": "IMG_1024.jpg",
  "contentType": "image/jpeg",
  "fileSize": 3811212,
  "checksumSha256": "hex"
}
```

### Init Response
```json
{
  "uploadId": "30e71f52-775f-4a2f-a25d-aed8a48ac5d8",
  "partSize": 5242880,
  "expiresAt": "2026-02-15T18:00:00.000Z"
}
```

### Part Upload Request
- Method: `POST /uploads/{uploadId}/part?partNumber=1`
- Headers:
  - `Authorization: Bearer <access-token>`
  - `Content-Type: application/octet-stream`
- Body: raw chunk bytes

### Part Upload Response
```json
{
  "uploadId": "30e71f52-775f-4a2f-a25d-aed8a48ac5d8",
  "partNumber": 1,
  "bytesStored": 5242880,
  "checksumSha256": "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
}
```

### Upload Status Response
```json
{
  "uploadId": "30e71f52-775f-4a2f-a25d-aed8a48ac5d8",
  "status": "uploading",
  "fileSize": 3811212,
  "partSize": 5242880,
  "uploadedBytes": 1048576,
  "uploadedParts": [1],
  "expiresAt": "2026-02-15T18:00:00.000Z"
}
```

### Complete Response
```json
{
  "mediaId": "2f4b3f2f-48f7-4f18-b3cb-c08de94461e2",
  "status": "processing",
  "deduplicated": false
}
```

`deduplicated=true` means an active media item with the same `checksumSha256` already existed for the same owner, so ingest reused that `mediaId` instead of creating a new one.

---

## 4) Library Service

### Endpoints
- `GET /library/timeline?cursor=&limit=&from=&to=&favorite=&archived=&hidden=&albumId=&personId=&q=`
- `GET /media/{mediaId}`
- `PATCH /media/{mediaId}`
- `DELETE /media/{mediaId}` (soft delete)
- `POST /media/{mediaId}/restore`
- `GET /media/{mediaId}/content?variant=original|thumb|small|playback`
- `GET /library/docs`
- `GET /library/openapi.json`

Notes:
- `albumId` and `personId` are reserved query parameters; relation-backed filtering is deferred to later phases.
- `thumb` and `small` are generated WebP derivatives.
- `playback` is a video-only variant and serves a derived `video/webm` (VP9/Opus) artifact.
- If a `playback` derivative is missing, library enqueues `media.derivatives.generate` and returns a retriable
  `503 PLAYBACK_DERIVATIVE_NOT_READY` error.
- Timeline items expose compact additive metadata as `metadataPreview` (`durationSec`, `codec`, `fps`, `width`, `height`).
- Media detail responses expose full additive metadata in `media.metadata` (capture/image/video/location/raw).

### Timeline Response
```json
{
  "items": [
    {
      "id": "med_789",
      "ownerId": "usr_123",
      "takenAt": "2025-12-31T23:12:00Z",
      "uploadedAt": "2026-02-15T10:00:00Z",
      "mimeType": "image/jpeg",
      "width": 4032,
      "height": 3024,
      "location": {"lat": 0, "lon": 0},
      "flags": {"favorite": true, "archived": false, "hidden": false, "deletedSoft": false},
      "derivatives": {
        "thumb": "/api/v1/media/med_789/content?variant=thumb",
        "small": "/api/v1/media/med_789/content?variant=small",
        "original": "/api/v1/media/med_789/content?variant=original"
      }
    }
  ],
  "nextCursor": "eyJzb3J0QXQiOiIyMDI2LTAyLTE1VDEwOjAwOjAwLjAwMFoiLCJpZCI6Im1lZF83ODkifQ"
}
```

### PATCH /media/{mediaId} Request
```json
{
  "favorite": true,
  "archived": false,
  "hidden": false,
  "takenAt": "2025-12-31T23:12:00Z"
}
```

### Media DTO
```json
{
  "id": "med_789",
  "ownerId": "usr_123",
  "takenAt": "2025-12-31T23:12:00Z",
  "uploadedAt": "2026-02-15T10:00:00Z",
  "mimeType": "image/jpeg",
  "width": 4032,
  "height": 3024,
  "location": {"lat": 0, "lon": 0},
  "flags": {"favorite": true, "archived": false, "hidden": false, "deletedSoft": false},
  "derivatives": {
    "thumb": "/api/v1/media/med_789/content?variant=thumb",
    "small": "/api/v1/media/med_789/content?variant=small",
    "original": "/api/v1/media/med_789/content?variant=original"
  }
}
```

---

## 5) Album + Sharing Service

### Album Endpoints
- `POST /albums`
- `GET /albums`
- `GET /albums/{albumId}`
- `PATCH /albums/{albumId}`
- `DELETE /albums/{albumId}`
- `POST /albums/{albumId}/items`
- `DELETE /albums/{albumId}/items/{mediaId}`
- `GET /albums/docs`
- `GET /albums/openapi.json`

### Sharing Endpoints
- `POST /shares/links` (public link)
- `PATCH /shares/links/{linkId}`
- `DELETE /shares/links/{linkId}`
- `POST /shares/invites`
- `POST /shares/family`
- `GET /shares/access/{token}`

### Share Permission Levels
- `view`
- `contribute`

---

## 6) Search Service

### Endpoints
- `GET /search?q=&cursor=&limit=&type=all|people|places|things`
- `POST /search/semantic`
- `POST /search/reindex/{mediaId}` (internal/admin)
- `GET /search/docs`
- `GET /search/openapi.json`

### Semantic Search Request
```json
{
  "text": "beach sunset with palm trees",
  "limit": 50
}
```

### Search Response
```json
{
  "items": [
    {"mediaId": "med_1", "score": 0.91, "reason": "semantic+metadata"}
  ],
  "facets": {
    "years": ["2024", "2025"],
    "people": ["person_11"],
    "places": ["Lisbon"]
  },
  "nextCursor": "cur_2"
}
```

### Search Backend Contract (Postgres + pgvector)
- Metadata columns indexed with B-tree/GIN as needed (`owner_id`, `taken_at`, `flags`, `place`).
- Full text query over extracted captions/tags.
- Vector query over `embedding vector(768)` (or configured size).
- Hybrid ranking strategy combines:
  - text relevance,
  - vector cosine similarity,
  - recency weight,
  - user interaction signals (favorites/albums, later phase).

---

## 7) ML / Face Service

### Endpoints
- `GET /people`
- `GET /people/{personId}`
- `PATCH /people/{personId}` (rename/merge/split)
- `GET /people/{personId}/media`
- `POST /face/reprocess/{mediaId}` (internal/admin)
- `GET /ml/docs`
- `GET /ml/openapi.json`

---

## 8) Memories Service

### Endpoints
- `GET /memories`
- `POST /memories/{memoryId}/dismiss`
- `POST /memories/{memoryId}/save-as-album`

---

## 9) Internal Async Contracts (BullMQ over Redis)

### Job `media.process`
```json
{
  "mediaId": "med_789",
  "ownerId": "usr_123",
  "relativePath": "usr_123/2026/02/med_789.jpg",
  "checksumSha256": "hex",
  "uploadedAt": "2026-02-15T10:00:00Z"
}
```

`media.process` compatibility requirements:
- Required keys: `mediaId`, `ownerId`, `relativePath`, `checksumSha256`, `uploadedAt`.
- Providers may add optional keys, but must not remove or rename required keys.
- Queue payload contract changes require same-task updates to docs, contract runner checks, and integration tests.

### Job `media.metadata.extract`
```json
{
  "mediaId": "med_789",
  "takenAt": "2025-12-31T23:12:00Z",
  "exif": {},
  "location": {"lat": 0, "lon": 0}
}
```

### Job `media.derivatives.generate`
```json
{
  "mediaId": "med_789",
  "ownerId": "usr_123",
  "relativePath": "usr_123/2026/02/med_789.jpg",
  "requestedAt": "2026-02-15T10:00:10Z"
}
```

`media.derivatives.generate` compatibility requirements:
- Required keys: `mediaId`, `relativePath`.
- Optional keys: `ownerId`, `requestedAt`.
- Worker generates both `thumb` and `small` WebP derivatives for each accepted job.

### Job `media.face.index`
```json
{
  "mediaId": "med_789",
  "personIds": ["person_11", "person_99"]
}
```

### Job `media.search.index`
```json
{
  "mediaId": "med_789",
  "indexedAt": "2026-02-15T10:00:30Z"
}
```

### Job `media.cleanup`
```json
{
  "mediaId": "med_789",
  "ownerId": "usr_123",
  "hardDeleteAt": "2026-03-17T00:00:00Z"
}
```

---

## 10) SLO-Oriented API Targets

- Upload init `p95 < 250ms`
- Timeline read `p95 < 500ms`
- Search `p95 < 700ms`
- Upload-to-searchable consistency `p95 <= 120s`
