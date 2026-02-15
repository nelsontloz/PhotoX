# PhotoX Personal Edition - Service Implementation Spec

## 1) Purpose

This document provides implementation-level specifications for each service so AI agents can build features consistently.

---

## 2) Shared Data and Contract Rules

### API Rules
- Base route prefix: `/api/v1`.
- JSON responses for all endpoints.
- Swagger UI and OpenAPI JSON are mandatory for every backend service.
- Preferred route convention per service: `/api/v1/<domain>/docs` and `/api/v1/<domain>/openapi.json`.
- Every implemented write endpoint (`POST`, `PATCH`, `PUT`) must include request body examples in OpenAPI.
- Every implemented endpoint must include OpenAPI summary and description fields.
- Endpoints requiring JWT auth must declare a bearer auth security requirement in OpenAPI.
- Standard error envelope:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  },
  "requestId": "uuid"
}
```

### Storage Rules
- Originals: `${PHOTOX_ORIGINALS_DIR}/{userId}/{yyyy}/{mm}/{mediaId}.{ext}`
- Derivatives: `${PHOTOX_DERIVED_DIR}/{mediaId}/{size}.jpg`
- DB stores only relative paths.

### Queue Rules (BullMQ)
- Queue names:
  - `media.process`
  - `media.metadata.extract`
  - `media.derivatives.generate`
  - `media.search.index`
  - `media.face.index`
  - `media.cleanup`
- Default retry policy: attempts `5`, exponential backoff starting at `3s`.
- Dead-letter queue required per queue group.

### Processing State Model
- `uploaded`
- `processing`
- `ready`
- `failed`
- `deleted_soft`
- `deleted_hard`

---

## 3) Service Specs

## 3.1 auth-service

Responsibilities:
- User registration and authentication.
- Token issue and refresh.
- Session invalidation.

Required endpoints:
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /me`
- `GET /auth/docs`
- `GET /auth/openapi.json`

Required tables (minimum):
- `users(id, email, password_hash, created_at, updated_at)`
- `sessions(id, user_id, refresh_token_hash, expires_at, revoked_at, created_at)`

Integration requirements:
- Login returns access + refresh token.
- Logout revokes refresh token.

---

## 3.2 ingest-service

Responsibilities:
- Chunked upload lifecycle.
- Checksum validation.
- Original file persistence.
- Enqueue initial processing job.

Required endpoints:
- `POST /uploads/init`
- `POST /uploads/{uploadId}/part`
- `POST /uploads/{uploadId}/complete`
- `POST /uploads/{uploadId}/abort`
- `GET /uploads/{uploadId}`
- `GET /uploads/docs`
- `GET /uploads/openapi.json`

Required tables (minimum):
- `upload_sessions(id, user_id, file_name, content_type, file_size, checksum_sha256, status, created_at, updated_at)`
- `upload_parts(upload_id, part_number, size, checksum, created_at)`
- `media(id, owner_id, relative_path, mime_type, status, created_at, updated_at)`

Idempotency requirements:
- `init` and `complete` accept `Idempotency-Key`.
- duplicate `complete` with same key returns same `mediaId`.

---

## 3.3 library-service

Responsibilities:
- Timeline read model.
- Media detail and flags.
- Soft delete and restore.

Required endpoints:
- `GET /library/timeline`
- `GET /media/{mediaId}`
- `PATCH /media/{mediaId}`
- `DELETE /media/{mediaId}`
- `POST /media/{mediaId}/restore`
- `GET /library/docs`
- `GET /library/openapi.json`

Required tables (minimum):
- `media_metadata(media_id, taken_at, uploaded_at, exif_json, location_json, width, height)`
- `media_flags(media_id, favorite, archived, hidden, deleted_soft, updated_at)`

Query/index requirements:
- composite index for timeline ordering by `(owner_id, taken_at desc, id desc)`.
- cursor token includes stable sort keys.

---

## 3.4 album-sharing-service

Responsibilities:
- Album CRUD and item membership.
- Public links, invite-only sharing, family groups.

Required endpoints:
- `POST/GET/PATCH/DELETE /albums...`
- `POST/PATCH/DELETE /shares/links...`
- `POST /shares/invites`
- `POST /shares/family`
- `GET /albums/docs`
- `GET /albums/openapi.json`

Required tables (minimum):
- `albums(id, owner_id, title, created_at, updated_at)`
- `album_items(album_id, media_id, added_at)`
- `share_links(id, resource_type, resource_id, token, expires_at, revoked_at)`
- `share_invites(id, resource_type, resource_id, invitee, permission, status)`
- `family_groups(id, owner_id, name, created_at)`
- `family_members(group_id, user_id, role, joined_at)`

Permission model:
- `view`
- `contribute`

---

## 3.5 search-service

Responsibilities:
- Metadata search and filtering.
- Full-text and semantic retrieval.
- Hybrid ranking response.

Required endpoints:
- `GET /search`
- `POST /search/semantic`
- `POST /search/reindex/{mediaId}`
- `GET /search/docs`
- `GET /search/openapi.json`

Schema requirements:
- `CREATE EXTENSION IF NOT EXISTS vector;`
- embedding column with configured dimension.
- ivfflat index (or chosen index strategy) for similarity queries.

Ranking formula requirements:
- combine normalized text score + vector score + recency weight.
- ACL filter always applied before response emission.

---

## 3.6 worker-service

Responsibilities:
- Consume BullMQ jobs.
- Run metadata extraction and derivatives.
- Trigger search and ML indexing jobs.

Required processors:
- `media.process`
- `media.metadata.extract`
- `media.derivatives.generate`
- `media.search.index`
- `media.face.index`
- `media.cleanup`

Required API docs endpoints:
- `GET /worker/docs`
- `GET /worker/openapi.json`

Reliability requirements:
- bounded retries with exponential backoff.
- dead-letter for non-recoverable failures.
- structured failure logs with job ID and media ID.

---

## 3.7 ml-service

Responsibilities:
- Face detection and embedding generation.
- Person clustering helper APIs.

Required endpoints:
- `GET /health`
- `GET /metrics`
- `POST /ml/faces/detect`
- `POST /ml/faces/embed`
- `POST /ml/faces/cluster`
- `GET /ml/docs`
- `GET /ml/openapi.json`

Contract requirements:
- deterministic response schema with version field.
- confidence thresholds configurable via env.

---

## 3.8 web-app

Responsibilities:
- Auth screens.
- Upload workflow.
- Timeline and media detail.
- Albums, sharing, search, people, memories views.

Minimum routes:
- `/` timeline
- `/upload`
- `/albums`
- `/search`
- `/people`
- `/memories`

UI requirements:
- all API errors shown with actionable feedback.
- optimistic updates only when rollback behavior is implemented.

---

## 4) Implementation Order

1. Auth + upload skeleton.
2. Metadata + derivatives + timeline.
3. Album and sharing ACL.
4. Search + pgvector ranking.
5. Faces + memories.
6. Operational hardening.

---

## 5) Migration and Versioning Rules

- One migration per schema change task.
- Migrations are forward-only.
- API changes must preserve `/api/v1` compatibility unless explicitly version-bumped.
- Any breaking contract change requires doc update and integration test update in same task.
