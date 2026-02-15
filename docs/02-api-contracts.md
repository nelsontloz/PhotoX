# PhotoX Personal Edition - API Contracts (v1)

## 1) Global Conventions

- Base path: `/api/v1`
- Auth: `Authorization: Bearer <jwt>`
- Content type: `application/json`
- Idempotency for critical writes: `Idempotency-Key` header
- Pagination: cursor-based (`cursor`, `nextCursor`, `limit`)

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

---

## 2) Auth Service

### Endpoints
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/refresh`
- `GET /me`
- `PATCH /me`

### Sample Login Request
```json
{
  "email": "user@example.com",
  "password": "secret"
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
    "name": "User"
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

### Me Response
```json
{
  "user": {
    "id": "usr_123",
    "email": "user@example.com",
    "name": null
  }
}
```

---

## 3) Ingest Service

### Endpoints
- `POST /uploads/init`
- `POST /uploads/{uploadId}/part`
- `POST /uploads/{uploadId}/complete`
- `POST /uploads/{uploadId}/abort`
- `GET /uploads/{uploadId}`

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
  "uploadId": "upl_abc",
  "partSize": 5242880,
  "expiresAt": "2026-02-15T18:00:00Z"
}
```

### Complete Response
```json
{
  "mediaId": "med_789",
  "status": "processing"
}
```

---

## 4) Library Service

### Endpoints
- `GET /library/timeline?cursor=&from=&to=&albumId=&personId=&q=`
- `GET /media/{mediaId}`
- `PATCH /media/{mediaId}`
- `DELETE /media/{mediaId}` (soft delete)
- `POST /media/{mediaId}/restore`

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
  "flags": {"favorite": true, "archived": false, "hidden": false},
  "derivatives": {
    "thumb": "/media/med_789/thumb.jpg",
    "small": "/media/med_789/small.jpg"
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
  "thumbPath": "med_789/thumb.jpg",
  "smallPath": "med_789/small.jpg"
}
```

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
