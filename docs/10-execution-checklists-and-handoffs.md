# PhotoX Personal Edition - Execution Checklists and Handoffs

Note:
- This checklist document defines target completion criteria.
- For the current as-built implementation snapshot, see `docs/11-current-implementation-status.md`.

## 1) Phase Checklists

## Phase P0 - Environment Baseline
- [ ] Docker daemon is running.
- [ ] Compose config validates.
- [ ] Postgres and Redis are healthy.
- [ ] Service scaffold health endpoints respond.
- [ ] Documentation links are accessible from docs index.

## Phase P1 - Auth + Upload
- [x] Auth endpoints implemented and tested.
- [x] Upload init/part/complete/abort implemented and tested.
- [x] Upload complete enqueues processing jobs.
- [x] Relative media paths persisted.
- [x] Unit + integration gates pass.

## Phase P2 - Web Auth + Upload UI
- [x] Register UI flow implemented (`/register`).
- [x] Login UI flow implemented (`/login`).
- [x] Authenticated upload flow implemented (`/upload`).
- [x] Upload progress and API error feedback implemented.
- [x] Web unit + integration gates pass.

## Phase P3 - Timeline
- [x] Timeline endpoint with cursor pagination implemented.
- [x] Timeline UI implemented (`/timeline`) and shows uploaded photos.
- [x] Derivatives generated and linked in responses.
- [x] Flags and media detail APIs implemented.
- [x] Soft delete and restore flow implemented.
- [x] Unit + integration gates pass.

## Phase P3.1 - Multi-File Upload UX
- [x] Upload page supports selecting multiple files.
- [x] Bounded concurrency implemented (`maxConcurrent=4`).
- [x] Continue-on-error behavior implemented (other files continue uploading).
- [x] Per-file progress/status and aggregate progress rendered in UI.
- [x] Upload batch summary renders success + failure results with actionable error text.
- [x] Web unit + integration gates pass for upload helpers.

## Phase P3.2 - Upload Dedupe
- [x] Ingest `complete` checks owner + checksum for existing active media.
- [x] Duplicate content reuses existing `mediaId` and returns `deduplicated=true`.
- [x] Duplicate `media.process` jobs are avoided for deduped completes.
- [x] Soft-deleted media are ignored by dedupe matching.
- [x] Ingest integration tests cover active dedupe and soft-delete bypass behavior.

## Phase P4 - Albums and Sharing
- [ ] Album CRUD complete.
- [ ] Public link sharing and revoke complete.
- [ ] Invite-only sharing complete.
- [ ] Family library flow complete.
- [ ] ACL checks verified by integration tests.

## Phase P5 - Search
- [ ] pgvector migration applied.
- [ ] Metadata + text search implemented.
- [ ] Semantic endpoint implemented.
- [ ] Hybrid ranking behavior validated.
- [ ] ACL filtering validated.

## Phase P6 - Faces, Memories, Hardening
- [ ] Face detection/embed/cluster API integration complete.
- [ ] People management APIs complete (rename/merge/split).
- [ ] Memories jobs and UI cards complete.
- [ ] Backup/restore scripts available.
- [ ] Reliability checks and regression tests pass.

---

## 2) Per-Task Completion Checklist

- [ ] Task objective and scope confirmed.
- [ ] Code implemented in allowed paths only.
- [ ] Migrations added if schema changed.
- [ ] Unit tests added/updated.
- [ ] Integration tests added/updated.
- [ ] Docs updated.
- [ ] Gate report completed.
- [ ] Next-task recommendation written.

---

## 3) Handoff Template

Use this template for handoff from AI agent to reviewer/operator.

```text
Handoff Title:
Task IDs:
Summary:

Changes:
- Services touched:
- Endpoints added/changed:
- Schema/migrations:
- Queue/job updates:
- Docs updated:

Verification:
- Build commands:
- Unit test commands:
- Integration test commands:
- Runtime health checks:

Risks/Notes:
- Known limitations:
- Follow-up tasks:

Recommendation:
- Next task ID to execute:
```

---

## 4) Release Readiness Checklist (Personal Deployment)

- [ ] Compose stack starts cleanly on target machine.
- [ ] Data directories for originals and derivatives are writable.
- [ ] Postgres backup script runs and restore procedure is documented.
- [ ] Core APIs return expected status and error envelopes.
- [ ] Upload + timeline critical path validated.
- [ ] Search critical path validated.
- [ ] Logs and metrics accessible in Prometheus/Grafana.

---

## 5) Escalation Rules

Escalate to human decision when:
- breaking API version changes are needed,
- schema migration impacts existing persisted data semantics,
- queue retry policy risks duplicate side effects,
- runtime blockers cannot be solved without changing infrastructure assumptions.
