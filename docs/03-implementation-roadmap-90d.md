# PhotoX Personal Edition - 90-Day Implementation Roadmap

## 1) Scope, Priorities, and Operating Rules

### Product Scope (v1)
- Web-only user experience.
- Photos-first implementation.
- Core parity goals: upload, timeline, albums, sharing, search, faces, memories.
- Personal-use deployment using Docker Compose.

### Priority Rule
- If tradeoffs are required, prioritize upload + web auth/upload UI first, then timeline.

### Linked Execution Docs
- Master execution protocol: `docs/06-ai-agent-master-runbook.md`
- Task contracts and prompts: `docs/07-ai-agent-task-contracts.md`
- Service implementation details: `docs/08-service-implementation-spec.md`
- Quality gate policy: `docs/09-testing-and-quality-gates.md`
- Checklists and handoffs: `docs/10-execution-checklists-and-handoffs.md`

---

## 2) Locked Technology Baseline

- Frontend: Next.js + TypeScript + Tailwind + TanStack Query
- Core APIs: Node.js 22 + Fastify
- ML APIs: Python FastAPI
- Database: PostgreSQL 16 + pgvector
- Queue/cache: Redis + BullMQ
- Image processing: sharp/libvips
- Gateway: Traefik
- Storage: local filesystem
- Monitoring: Prometheus + Grafana
- Test strategy: unit + integration mandatory

---

## 3) 90-Day Delivery Plan with Task IDs

## Days 1-30 (Phase P0/P1/P2): Foundation, Upload Backend, Web Auth/Upload UI

Primary objective:
- deliver reliable upload backend and first usable web UX (register/login/upload) with strict quality gates.

Target tasks:
- `E1-S1`: compose baseline and env wiring
- `E1-S2`: gateway routing baseline
- `E1-S3`: storage adapter and path policy
- `E1-S4`: Swagger/OpenAPI baseline for every backend service
- `E2-S1`: register/login/refresh
- `E2-S2`: session management
- `E3-S1`: chunked upload lifecycle
- `E3-S2`: checksum and dedupe pre-check
- `E3-S3`: metadata extraction job
- `E3-S4`: derivative generation job
- `P2-UI-S1` (proposed): web register/login flows
- `P2-UI-S2` (proposed): authenticated upload page with chunked upload progress

Required outcomes:
- users can register/login via web UI and upload large photos via web upload flow.
- upload completion emits BullMQ processing jobs.
- every backend service exposes `/api/v1/<domain>/docs` and `/api/v1/<domain>/openapi.json`.

Phase exit gates:
- all P0/P1/P2 task reports complete.
- unit and integration tests pass for touched services.

## Days 31-60 (Phase P3/P4): Timeline, Albums, Sharing

Target tasks:
- `E4-S1`: timeline query API
- `E4-S2`: media detail API
- `P3.1-UI-S1`: multi-file upload UX with bounded concurrency (4)
- `P3.2-INGEST-S1`: dedupe repeated uploads by owner + checksum
- `P3.3-UI-S1`: timeline modal high-resolution viewer with navigation
- `E5-S1`: album CRUD
- `E5-S2`: public links
- `E5-S3`: invite sharing
- `E5-S4`: family library

Required outcomes:
- timeline and media detail APIs are stable and derivative-backed.
- upload UI supports multi-file batches with per-file outcomes and bounded concurrency.
- ingest dedupe prevents duplicate active media records for repeated identical uploads.
- timeline UI supports modal high-resolution browsing with next/previous and auto-load navigation.
- sharing model works with ACL enforcement.

Phase exit gates:
- timeline API pagination and consistency checks pass.
- ACL integration tests pass.

## Days 61-90 (Phase P5/P6): Search, Faces, Memories, Hardening

Target tasks:
- `E6-S1`: metadata indexing
- `E6-S2`: keyword/faceted search
- `E6-S3`: semantic search
- `E6-S4`: pgvector setup
- `E7-S1`: face detection + embeddings
- `E7-S2`: clustering and person pages
- `E7-S3`: merge/split controls
- `E8-S1`: on-this-day memories jobs
- `E8-S2`: memory cards UI
- `E8-S3`: save memory as album
- `E9-S1`: backup scripts
- `E9-S2`: restore drill
- `E9-S3`: reindex/reprocess tools
- `E9-S4`: observability hardening

Required outcomes:
- search supports metadata + semantic retrieval.
- people and memories experiences are functional.
- backup and restore workflows verified.

Phase exit gates:
- full task gate matrix passes.
- release readiness checklist in `docs/10-execution-checklists-and-handoffs.md` is complete.

## Post-90 (Phase P100): Deferred Security Tech Debt

Target tasks:
- `P100-S1`: browser token storage migration to secure cookie-based auth session flow.
- `P100-S2`: production secret hard-fail policy for auth, ingest, and library services.

Required outcomes:
- Web auth/session no longer depends on browser-readable token persistence.
- Production deployments fail fast when JWT secrets are missing or insecure.
- Security hardening tests are added to regular quality gates.

Phase exit gates:
- P100 acceptance criteria in `docs/04-backlog-epics-stories.md` are fully met.
- `AUDIT_REPORT.md` items for token storage and default secret posture are marked closed.

---

## 4) Cadence and Reporting

Weekly cycle:
- Monday: select tasks and lock scope.
- Tuesday-Thursday: execute implementation contracts.
- Friday: run full gates and produce handoff reports.

Per-task report format:
- use artifact template in `docs/06-ai-agent-master-runbook.md`.

---

## 5) Roadmap-Level Risks and Mitigations

- Search quality drift
  - Mitigation: improve metadata quality before rank tuning.
- Face clustering false merges
  - Mitigation: keep manual merge/split controls and conservative clustering threshold.
- Filesystem path regressions
  - Mitigation: enforce relative-path policy tests.
- Async pipeline instability
  - Mitigation: BullMQ retries with dead-letter handling and integration tests.
