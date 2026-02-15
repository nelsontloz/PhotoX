# PhotoX Personal Edition - AI Agent Task Contracts

## 1) Contract Schema

Every implementation task must be expressed with this schema before coding starts.

```yaml
task_id: string
title: string
objective: string
inputs:
  - backlog_story_ids
  - referenced_docs
scope:
  include_paths:
    - path
  exclude_paths:
    - path
dependencies:
  blocked_by:
    - task_id
implementation_steps:
  - ordered step
testing:
  unit:
    - required tests
  integration:
    - required tests
quality_gates:
  - gate statement
deliverables:
  - code
  - tests
  - docs updates
  - verification report
done_criteria:
  - measurable outcome
```

---

## 2) Global Rules for All Tasks

- Use Docker-based local execution commands from `docs/05-local-dev-quickstart.md`.
- Keep API paths under `/api/v1`.
- Return standardized error envelope.
- Update OpenAPI spec for every API surface change.
- Add unit and integration tests for all non-trivial logic.
- Produce final artifact report defined in `docs/06-ai-agent-master-runbook.md`.

---

## 3) Prompt Library (Copy-Paste)

These prompts are model-agnostic and can be pasted into any coding agent.

### Prompt A1 - Auth Foundation

```text
Implement Task A1 (Auth Foundation) for PhotoX.

Objective:
- Build register/login/refresh/logout/me APIs in auth service.

Scope:
- Allowed: services/auth, docs/02-api-contracts.md, tests related to auth.
- Disallowed: other services unless required for shared type contracts.

Requirements:
- Follow /api/v1 contract.
- JWT access + refresh lifecycle.
- Consistent error envelope.
- /health and /metrics endpoints remain functional.

Testing:
- Unit tests for token and validation logic.
- Integration tests for register/login/refresh/logout/me flows.

Deliverables:
- Code + tests + API docs update + verification report.
```

### Prompt U1 - Upload Init/Part/Complete

```text
Implement Task U1 (Chunked Upload Pipeline) for PhotoX.

Objective:
- Implement upload init/part/complete/abort/status with checksum validation and idempotency support.

Scope:
- Allowed: services/ingest, services/library (if metadata stub needed), shared contracts, tests, docs.

Requirements:
- Store originals in configured filesystem path.
- Persist relative path only.
- Enqueue BullMQ media processing job on complete.
- Large file upload must resume after interruption.

Testing:
- Unit tests for checksum, chunk assembly, and idempotency behavior.
- Integration tests for full upload flow and abort/retry behavior.

Deliverables:
- Code + tests + queue contract docs + verification report.
```

### Prompt M1 - Metadata Extraction

```text
Implement Task M1 (Metadata Extraction) for PhotoX.

Objective:
- Extract EXIF fields, normalize timestamps, store metadata model.

Scope:
- Allowed: services/worker, services/library, shared schema/migrations, tests, docs.

Requirements:
- Parse EXIF safely with fallback for missing data.
- Normalize timezone behavior.
- Mark media processing state transitions.

Testing:
- Unit tests for parser and normalization utilities.
- Integration tests verifying metadata persistence after upload complete.

Deliverables:
- Code + migrations (if needed) + tests + verification report.
```

### Prompt W1 - Derivative Worker

```text
Implement Task W1 (Derivative Generation Worker) for PhotoX.

Objective:
- Generate thumb and small derivatives from originals using sharp.

Scope:
- Allowed: services/worker, services/library, tests, docs.

Requirements:
- BullMQ consumer with retry/backoff and dead-letter handling.
- Save derivatives to configured derived path.
- Record derivative status and paths in metadata model.

Testing:
- Unit tests for resize helpers and path composition.
- Integration tests for end-to-end derivative generation triggered by upload completion.

Deliverables:
- Code + tests + queue policy docs + verification report.
```

### Prompt L1 - Timeline Query API

```text
Implement Task L1 (Timeline Core) for PhotoX.

Objective:
- Build timeline endpoint with cursor pagination and filters.

Scope:
- Allowed: services/library, apps/web timeline integration, tests, docs.

Requirements:
- Filters: date range, album, person, and flags.
- Stable cursor ordering.
- Return derivative URLs for display cards.

Testing:
- Unit tests for cursor encoding/decoding and filter composition.
- Integration tests for pagination consistency and filter behavior.

Deliverables:
- Code + tests + updated API docs + verification report.
```

### Prompt S1 - Semantic Search

```text
Implement Task S1 (Search + pgvector) for PhotoX.

Objective:
- Implement hybrid metadata and semantic search in search service.

Scope:
- Allowed: services/search, schema/migrations, tests, docs.

Requirements:
- Enable pgvector extension and embedding column/index.
- Hybrid ranking combines text relevance, vector similarity, and recency.
- Respect ACL scope constraints in results.

Testing:
- Unit tests for ranking composition.
- Integration tests for keyword and semantic scenarios.

Deliverables:
- Code + migration + tests + benchmark notes + verification report.
```

### Prompt F1 - Face Pipeline Integration

```text
Implement Task F1 (Face Pipeline) for PhotoX.

Objective:
- Integrate FastAPI ML endpoints with TS services for face detection and clustering.

Scope:
- Allowed: services/ml, services/worker, services/library, apps/web people pages, tests, docs.

Requirements:
- ML endpoint contract versioned and documented.
- Persist embeddings and cluster assignment references.
- Expose merge/split/rename controls through API.

Testing:
- Unit tests for cluster operations.
- Integration tests for pipeline from upload to people view.

Deliverables:
- Code + tests + contract docs + verification report.
```

### Prompt Q1 - Unit + Integration Gates

```text
Implement Task Q1 (Quality Gates Enforcement) for PhotoX.

Objective:
- Ensure all modified services have required unit and integration coverage.

Scope:
- Allowed: tests, CI scripts/config, docs.

Requirements:
- Add missing test suites for recently changed modules.
- Ensure integration tests run against Docker-backed dependencies.
- Output pass/fail matrix by service.

Deliverables:
- Tests + CI updates + quality report.
```

### Prompt D1 - Documentation Sync

```text
Implement Task D1 (Documentation Sync) for PhotoX.

Objective:
- Align architecture, API contracts, backlog, and quickstart docs with implemented behavior.

Scope:
- Allowed: docs directory.

Requirements:
- Update changed endpoints, workflows, and commands.
- Add migration notes if schema changed.
- Cross-link docs for agent navigation.

Deliverables:
- Docs delta + verification report listing all updated files.
```

---

## 4) Task Completion Record

Each task should append this compact record to the working notes:

```text
TASK <id> STATUS: completed|blocked
BLOCKERS:
FILES:
TESTS:
DOCS:
NEXT:
```
