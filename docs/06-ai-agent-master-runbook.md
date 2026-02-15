# PhotoX Personal Edition - AI Agent Master Runbook

## 1) Purpose and Scope

This runbook defines how any AI coding agent should execute the PhotoX implementation with predictable quality and minimal ambiguity.

- Audience: model-agnostic coding agents and human reviewers.
- Runtime baseline: Docker Engine + Docker Compose.
- Product scope: personal-use, web-first, photos-first.
- Primary objective under tradeoffs: upload + timeline first.
- Quality posture: strict gates, unit + integration tests mandatory.

Use this runbook together with:
- `docs/07-ai-agent-task-contracts.md`
- `docs/08-service-implementation-spec.md`
- `docs/09-testing-and-quality-gates.md`
- `docs/10-execution-checklists-and-handoffs.md`

---

## 2) Stack and Architectural Constraints

- Frontend: Next.js (TypeScript), Tailwind, TanStack Query.
- Backend services: Node.js 22 + Fastify (TypeScript target architecture).
- ML service: Python FastAPI.
- Data: PostgreSQL 16 + pgvector.
- Queue and cache: Redis + BullMQ.
- Image derivatives: sharp/libvips.
- Storage: local filesystem using relative media paths in DB.
- Gateway: Traefik.
- Observability: Prometheus + Grafana baseline.

Non-negotiable constraints:
- Do not store absolute filesystem paths in database records.
- Do not break `/api/v1` contract envelope without doc + test updates.
- Do not ship endpoint changes without matching integration tests.
- Every backend service must expose both Swagger UI and OpenAPI JSON endpoints.
- Do not close tasks without artifact report defined in this runbook.

---

## 3) Repository Entry Points

- Compose: `docker-compose.yml`
- Environment template: `.env.example`
- Monitoring config: `infra/prometheus/prometheus.yml`
- Web app: `apps/web`
- Core services: `services/auth`, `services/ingest`, `services/library`, `services/album-sharing`, `services/search`, `services/worker`
- ML service: `services/ml`

---

## 4) Orchestrator Execution Model

Use a single orchestrator agent that executes tasks sequentially and only parallelizes independent sub-steps inside a task.

Task lifecycle:
1. Select task ID from `docs/04-backlog-epics-stories.md`.
2. Load matching task contract in `docs/07-ai-agent-task-contracts.md`.
3. Execute implementation plan from `docs/08-service-implementation-spec.md`.
4. Run all quality gates from `docs/09-testing-and-quality-gates.md`.
5. Produce handoff artifact from `docs/10-execution-checklists-and-handoffs.md`.
6. Only then mark task complete.

If blocked:
- First attempt local mitigation steps.
- If still blocked, produce a blocker report with reproducible command output, affected files, and one recommended unblock path.

---

## 5) Phased Delivery Order

Execute phases in order; do not skip gates.

### Phase P0 - Environment and Baseline
- Validate Docker daemon and compose config.
- Start infra services.
- Validate health endpoints for scaffold services.

Exit criteria:
- `docker compose --env-file .env.example config` succeeds.
- Postgres and Redis healthy.

### Phase P1 - Auth + Upload Skeleton
- Implement auth flows and token lifecycle.
- Implement upload init/part/complete and metadata record creation.
- Introduce BullMQ job enqueue on upload complete.

Exit criteria:
- Upload of large image (>25 MB) succeeds via chunking.
- Upload completion generates processing job and metadata stub.

### Phase P2 - Timeline Core
- Implement timeline read model and filters.
- Generate and serve derivatives for timeline cards.

Exit criteria:
- Timeline query pagination stable.
- New upload appears in timeline in <= 120 seconds.

### Phase P3 - Albums and Sharing
- Implement album CRUD and item management.
- Implement public links, invite-only, family sharing ACL flows.

Exit criteria:
- Shared access permissions enforced.

### Phase P4 - Search and Semantic Retrieval
- Implement metadata and text search.
- Add pgvector semantic retrieval and hybrid ranking.

Exit criteria:
- Search endpoint returns relevant results for text and semantic prompts.

### Phase P5 - Faces, Memories, and Hardening
- Implement face detection and clustering workflows.
- Implement memories jobs and UI cards.
- Complete backup/restore scripts and reliability checks.

Exit criteria:
- Face clustering controls (rename/merge/split) functional.
- Backup and restore drill passes.

---

## 6) Standard Implementation Workflow Per Task

For each task, produce work in this order:
1. Read service spec and acceptance criteria.
2. Add or update database migration if schema changes.
3. Implement API routes and service logic.
4. Implement queue producers/consumers if async flow is involved.
5. Implement observability (`/health`, `/metrics`, structured logs).
6. Add/adjust unit tests.
7. Add/adjust integration tests.
8. Update API docs and linked docs.
9. Run quality gates and produce report.

---

## 7) Mandatory Output Artifact

Every task must finish with a report using this template:

```text
Task ID:
Objective:
Files changed:
Database changes:
API changes:
Queue changes:
Tests added/updated:
Commands run:
Gate results:
Known limitations:
Next task recommendation:
```

Task is incomplete if any section is missing.

---

## 8) Risk Controls

- Idempotency: all upload and share-link mutation endpoints must support idempotency keys.
- Retry safety: BullMQ jobs must define attempts, backoff, and dead-letter handling.
- Data integrity: no hard-delete in synchronous user request path.
- Search consistency: async indexing is acceptable; API must expose processing state.
- Fail-open policy: if ML fails, upload/timeline must continue.

---

## 9) Definition of Done

A task is done only when:
- implementation meets acceptance criteria,
- required unit + integration tests pass,
- docs are updated,
- artifact report is complete,
- no unresolved high-severity runtime errors remain.
