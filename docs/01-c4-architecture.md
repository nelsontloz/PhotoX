# PhotoX Personal Edition - C4 Architecture

## 1) System Context (C1)

### Goal
PhotoX Personal Edition is a web-first, self-hosted photo platform designed as a low-cost alternative to Google Photos for personal use.

### Primary Actor
- **Consumer User (Owner):** uploads photos, browses timeline, creates albums, shares content, searches by text/semantic concepts/faces, and views memories.

### External Systems
- **Local Filesystem Storage:** stores original and derived image files on mounted host volumes.
- **Email Provider (optional later):** invite notifications and account recovery.

### Context Relationships
- User interacts with `Web App` over HTTPS.
- `Web App` calls platform APIs via `Traefik Gateway`.
- Platform services use databases, queue/event bus, and filesystem storage.

### Technology Stack (Locked)
- **Frontend:** Next.js (TypeScript), Tailwind CSS, TanStack Query
- **Gateway:** Traefik
- **Core services:** Node.js 22 + Fastify (TypeScript)
- **ML service:** Python 3.12 + FastAPI
- **Database:** PostgreSQL 16 + pgvector extension
- **Cache and job queue:** Redis + BullMQ
- **Image processing:** sharp/libvips
- **Storage:** local filesystem volumes
- **Observability:** Prometheus + Grafana (baseline)

---

## 2) Container Diagram (C2)

### Edge and Access
- **web-app (Next.js):** UI for timeline, albums, sharing, search, faces, memories.
- **gateway (Traefik):** single public API entry point, host/path routing, TLS termination.

### Core Services
- **auth-service:** registration, login, sessions, profile.
- **ingest-service:** chunked uploads, checksum validation, dedupe pre-check, write originals.
- **library-service:** metadata, timeline queries, media flags (favorite/archive/hidden), delete/restore.
- **album-sharing-service:** album management + all sharing modes (public links, invite-only, family library).
- **search-service:** metadata search + semantic retrieval orchestration.
- **ml-service:** labels, embeddings, face detection/clustering.
- **worker-service:** asynchronous jobs (derivatives, indexing, memories, cleanup).

### Data and Infra Containers
- **Postgres + pgvector:** source of truth plus vector similarity for semantic search.
- **Redis:** session cache, hot query cache, rate-limit counters, and BullMQ backing store.
- **BullMQ workers:** async processing for derivatives, indexing, memories, cleanup.
- **Local filesystem volumes:**
  - `/data/photox/originals`
  - `/data/photox/derived`

---

## 3) Component and Flow View (C3)

### A) Upload Pipeline
1. Web app calls `POST /uploads/init`.
2. Client uploads chunks to `ingest-service`.
3. Ingest validates checksum and writes file to `/data/photox/originals/...`.
4. Ingest stores initial media record and enqueues a `media.process` BullMQ job.
5. Worker consumes the job and triggers:
   - derivative generation (thumbnails/previews),
   - metadata extraction (EXIF/time/location),
   - ML inference (labels/faces),
   - search indexing in Postgres/pgvector.

### B) Timeline Read
1. Web app requests timeline from `library-service`.
2. Library checks ACL + filters and returns paginated media list.
3. Derivative URLs are generated for display-ready images.

### C) Search
1. Web app sends query to `search-service`.
2. Service executes hybrid retrieval in PostgreSQL (metadata filters + full text + pgvector).
3. Results are ACL-filtered through metadata ownership/sharing scopes.
4. Ranked list is returned with facets.

### D) Sharing
1. User creates share via `album-sharing-service`.
2. Service persists ACL policy and share token metadata.
3. Shared reads are validated by token and permission level.

### E) Delete Lifecycle
1. User requests delete (soft delete).
2. `library-service` marks record as deleted and enqueues `media.cleanup`.
3. Cleanup worker removes derivatives/index entries.
4. Hard-delete worker permanently removes files and metadata after retention window.

---

## 4) Deployment View (C4)

### Docker Compose Layout
- `traefik` (gateway/reverse proxy)
- `web-app`
- `auth-service`
- `ingest-service`
- `library-service`
- `album-sharing-service`
- `search-service`
- `ml-service`
- `worker-service`
- `postgres`
- `redis`
- `prometheus`
- `grafana`

### Compose Reference
- Main compose file: `docker-compose.yml`
- Environment template: `.env.example`
- Prometheus scrape config: `infra/prometheus/prometheus.yml`
- Infra-only startup: `docker compose --env-file .env.example up -d`
- Full stack startup (with app profile): `docker compose --env-file .env.example --profile app up -d`

### Volume Mounts
- Host path mounted into services requiring media I/O:
  - `/data/photox/originals`
  - `/data/photox/derived`

### Runtime Principles
- Keep sync APIs fast; move heavy work to async workers.
- If ML/search degrades, uploads and timeline remain available.
- All services expose `/health` endpoints and structured logs.
- Queue-driven background jobs run through BullMQ on Redis.
- All backend services expose Swagger UI and OpenAPI JSON under service-scoped `/api/v1/*` routes.

---

## 5) Key Architectural Decisions

- **Microservices, but lean boundaries:** keeps clear ownership while limiting operational overhead.
- **Filesystem storage adapter:** preserves future migration path to S3-compatible storage.
- **Event-driven media pipeline:** improves perceived latency and reliability.
- **Photos-first scope:** shortens time-to-value and reduces transcoding complexity.

---

## 6) AI Implementation References

- `docs/06-ai-agent-master-runbook.md`
- `docs/07-ai-agent-task-contracts.md`
- `docs/08-service-implementation-spec.md`
- `docs/09-testing-and-quality-gates.md`
- `docs/10-execution-checklists-and-handoffs.md`
