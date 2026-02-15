# PhotoX Personal Edition - Implementation Backlog (Agent-Ready)

## 1) How to Read This Backlog

- Each story has a stable ID: `E<epic>-S<story>`.
- `Blocked by` defines execution dependencies.
- `Required tests` defines minimum gate expectations.
- Story is complete only when acceptance criteria and required tests pass.

Related docs:
- Contracts and prompts: `docs/07-ai-agent-task-contracts.md`
- Service implementation details: `docs/08-service-implementation-spec.md`
- Quality gates: `docs/09-testing-and-quality-gates.md`

---

## Epic 1 - Platform Foundation

### E1-S1 Compose Stack Bootstrap
Blocked by: none

Acceptance criteria:
- `docker-compose.yml` starts required services.
- `.env.example` covers all required env vars.
- `docker compose --env-file .env.example config` succeeds.

Required tests:
- Integration: compose validation and health checks.

### E1-S2 Gateway Routing Baseline
Blocked by: E1-S1

Acceptance criteria:
- Gateway routes web and `/api/v1` service paths.
- Route mapping documented.

Required tests:
- Integration: gateway path routing tests.

### E1-S3 Filesystem Storage Adapter
Blocked by: E1-S1

Acceptance criteria:
- Adapter supports put/get/exists/delete.
- DB uses relative media paths only.

Required tests:
- Unit: adapter path and operation tests.
- Integration: write/read/delete against mounted volume.

### E1-S4 OpenAPI Contract Baseline
Blocked by: E1-S1

Acceptance criteria:
- each backend service exposes service-scoped OpenAPI JSON.
- each backend service exposes service-scoped Swagger UI.
- contract docs synchronized with route implementation.

Required tests:
- Integration: OpenAPI and Swagger endpoint availability.

### E1-S5 Observability Baseline
Blocked by: E1-S1

Acceptance criteria:
- Prometheus and Grafana run via compose.
- Each service exposes `/metrics`.

Required tests:
- Integration: metrics endpoint and scrape checks.

---

## Epic 2 - Identity and Access

### E2-S1 Register/Login/Refresh
Blocked by: E1-S1, E1-S4

Acceptance criteria:
- User can register, log in, and refresh token.
- Error envelope conforms to API contract.

Required tests:
- Unit: token and validation logic.
- Integration: register/login/refresh flows.

### E2-S2 Session Management
Blocked by: E2-S1

Acceptance criteria:
- Logout revokes active refresh token.
- Expired or revoked sessions are rejected.

Required tests:
- Unit: session revocation logic.
- Integration: logout and revoked token behavior.

### E2-S3 ACL Middleware
Blocked by: E2-S1

Acceptance criteria:
- Owner-only resources are protected.
- Shared access permission checks are consistent.

Required tests:
- Unit: ACL evaluator.
- Integration: protected route access matrix.

---

## Epic 3 - Upload and Media Processing

### E3-S1 Chunked Upload API
Blocked by: E1-S1, E1-S3, E2-S1

Acceptance criteria:
- init/part/complete/abort/status endpoints functional.
- interrupted upload can resume safely.

Required tests:
- Unit: chunk orchestration.
- Integration: full upload lifecycle.

### E3-S2 Checksum and Dedupe Pre-check
Blocked by: E3-S1

Acceptance criteria:
- invalid checksum requests are rejected.
- duplicate upload detection is idempotent.

Required tests:
- Unit: checksum and idempotency logic.
- Integration: duplicate complete request behavior.

### E3-S3 Metadata Extraction Worker
Blocked by: E3-S1

Acceptance criteria:
- EXIF and timestamp normalization persisted.
- upload complete enqueues metadata process job.

Required tests:
- Unit: metadata parser utilities.
- Integration: upload-to-metadata persistence flow.

### E3-S4 Derivative Generation Worker
Blocked by: E3-S1

Acceptance criteria:
- thumb/small derivatives generated via sharp.
- library reads derivative paths in responses.

Required tests:
- Unit: image transform helpers.
- Integration: derivative generation job flow.

### E3-S5 BullMQ Reliability Policies
Blocked by: E3-S3, E3-S4

Acceptance criteria:
- retries and backoff configured.
- dead-letter queue exists and is used on repeated failure.

Required tests:
- Unit: retry strategy logic.
- Integration: forced failure to dead-letter path.

---

## Epic 4 - Library and Timeline

### E4-S1 Timeline Query API
Blocked by: E3-S3, E3-S4

Acceptance criteria:
- cursor pagination stable and deterministic.
- date and basic filters supported.

Required tests:
- Unit: cursor and filter composition.
- Integration: pagination and filter behavior.

### E4-S2 Media Detail API
Blocked by: E4-S1

Acceptance criteria:
- media detail includes metadata, flags, derivatives.

Required tests:
- Integration: media detail contract checks.

### E4-S3 Media Flags
Blocked by: E4-S1

Acceptance criteria:
- favorite/archive/hidden flags can be updated.
- timeline reflects flag behavior.

Required tests:
- Unit: flag state transitions.
- Integration: API + timeline filter behavior.

### E4-S4 Soft Delete and Restore
Blocked by: E4-S2

Acceptance criteria:
- delete performs soft delete.
- restore reactivates media.

Required tests:
- Integration: delete and restore lifecycle.

---

## Epic 5 - Albums and Sharing

### E5-S1 Album CRUD
Blocked by: E2-S3, E4-S1

Acceptance criteria:
- create/read/update/delete album.
- add/remove media item operations.

Required tests:
- Unit: album domain rules.
- Integration: album CRUD and item management.

### E5-S2 Public Link Sharing
Blocked by: E5-S1

Acceptance criteria:
- create/revoke link.
- expiry behavior enforced.

Required tests:
- Unit: link token policy.
- Integration: public access and revocation flow.

### E5-S3 Invite-Only Sharing
Blocked by: E5-S1

Acceptance criteria:
- invite by user/email supported.
- permission scope enforced (`view`, `contribute`).

Required tests:
- Integration: invite acceptance and access checks.

### E5-S4 Family Library Sharing
Blocked by: E5-S1

Acceptance criteria:
- family group/member model implemented.
- shared read permissions follow membership.

Required tests:
- Integration: family group access matrix.

---

## Epic 6 - Search

### E6-S1 Metadata Indexing
Blocked by: E3-S3

Acceptance criteria:
- searchable metadata fields persist and update.
- manual reindex endpoint works.

Required tests:
- Integration: indexing and reindex behavior.

### E6-S2 Keyword and Faceted Search
Blocked by: E6-S1, E2-S3

Acceptance criteria:
- keyword queries return scoped results.
- facets and pagination stable.

Required tests:
- Unit: query parser and facet builder.
- Integration: keyword/facet scenarios.

### E6-S3 Semantic Search
Blocked by: E6-S4

Acceptance criteria:
- natural language query returns relevant matches.
- ranking blends semantic and metadata signals.

Required tests:
- Unit: score blending logic.
- Integration: semantic scenarios.

### E6-S4 pgvector Setup and Migration
Blocked by: E1-S1

Acceptance criteria:
- pgvector extension enabled.
- embedding column and index present.

Required tests:
- Integration: migration and vector query smoke tests.

---

## Epic 7 - Faces and People

### E7-S1 Face Detection and Embeddings
Blocked by: E3-S1, E6-S4

Acceptance criteria:
- ML detect/embed endpoints integrated.
- embeddings persisted.

Required tests:
- Unit: payload validation.
- Integration: upload-to-face-index path.

### E7-S2 Person Clustering
Blocked by: E7-S1

Acceptance criteria:
- clusters generated and queryable.
- person pages list associated media.

Required tests:
- Unit: clustering helper behavior.
- Integration: people list and person media endpoints.

### E7-S3 Merge/Split Controls
Blocked by: E7-S2

Acceptance criteria:
- manual merge and split operations available.

Required tests:
- Integration: merge/split API behavior.

---

## Epic 8 - Memories

### E8-S1 On This Day Job
Blocked by: E4-S1

Acceptance criteria:
- daily job generates memory candidates.

Required tests:
- Unit: date grouping logic.
- Integration: memory job output persistence.

### E8-S2 Memory Cards UI
Blocked by: E8-S1

Acceptance criteria:
- memory cards visible in web UI.
- dismiss behavior supported.

Required tests:
- Integration: memory API to UI rendering.

### E8-S3 Save Memory as Album
Blocked by: E8-S2, E5-S1

Acceptance criteria:
- one action converts memory to album.

Required tests:
- Integration: memory-to-album flow.

---

## Epic 9 - Reliability and Operations

### E9-S1 Backup Scripts
Blocked by: E1-S1

Acceptance criteria:
- Postgres and media snapshot backup commands created.
- output is timestamped and documented.

Required tests:
- Integration: backup script dry run.

### E9-S2 Restore Drill
Blocked by: E9-S1

Acceptance criteria:
- restore procedure recreates usable environment.

Required tests:
- Integration: restore verification checks.

### E9-S3 Reindex/Reprocess Tools
Blocked by: E6-S1, E7-S1

Acceptance criteria:
- operators can trigger per-media reindex/reprocess flows.

Required tests:
- Integration: reindex/reprocess command and API checks.

### E9-S4 Observability Hardening
Blocked by: E1-S5

Acceptance criteria:
- all services expose health and metrics.
- dashboards and scrape targets are documented.

Required tests:
- Integration: metrics scrape and service health checks.

---

## 10) Priority Order

1. Epic 1 -> Epic 2 -> Epic 3 -> Epic 4
2. Epic 5 -> Epic 6
3. Epic 7 -> Epic 8
4. Epic 9 spans all phases and is finalized last
