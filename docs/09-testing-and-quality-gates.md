# PhotoX Personal Edition - Testing and Quality Gates

## 1) Policy

All implementation tasks require unit and integration tests. No exceptions for feature code.

- Unit tests validate deterministic business logic.
- Integration tests validate API contracts, persistence and queue semantics, and service interaction using embedded apps with deterministic in-memory mocks by default.
- E2E tests are optional in this phase and can be added later.

---

## 2) Required Gate Matrix

Task cannot be marked complete unless every applicable gate passes.

Gate G1 - Build and Type Integrity
- Service builds successfully.
- No unresolved runtime import/module errors.

Gate G2 - Unit Tests
- New/changed logic has unit tests.
- Minimum expectation: all added public functions have happy-path and failure-path tests.

Gate G3 - Integration Tests
- Endpoints changed by task must have integration tests.
- Async job flow changes must include integration coverage for enqueue and consume behavior.
- Node service integration suites must remain hermetic and must not require PostgreSQL/Redis/RabbitMQ runtime dependencies.

Gate G4 - Contract and Docs
- API contract updates reflected in docs and OpenAPI.
- Implemented write endpoints include OpenAPI request examples and response examples.
- Implemented endpoints include OpenAPI summary + description metadata.
- Queue payload changes reflected in docs and tests.
- Backend services expose Swagger UI and OpenAPI JSON at versioned service routes.

Gate G5 - Runtime Health
- Service exposes `/health` and `/metrics`.
- Compose stack starts with service healthy state.
- Swagger UI and OpenAPI endpoints return HTTP 200.

Gate G6 - Verification Artifact
- Task report completed with commands run and results.

Gate G7 - Contract Compatibility
- Pact consumer/provider verification passes for changed HTTP boundaries.
- Pact message verification passes for changed async boundaries.
- Per-service `npm test` contract evidence is attached in command log.
- Pact provider/message verification is mock-based and hermetic (embedded app + in-memory mocks) and does not require PostgreSQL, Redis, RabbitMQ, or live service endpoints.
- `PACT_BROKER_BASE_URL` is present for pact publish/verification workflows.

---

## 3) Service-Level Test Expectations

### auth-service
- Unit:
  - token issue/verify helpers
  - password validation and normalization
- Integration:
  - register/login/refresh/logout/me
  - expired/revoked token handling
  - embedded Fastify app with in-memory DB mock (no live Postgres)

### ingest-service
- Unit:
  - checksum validation
  - chunk assembly and finalization
  - idempotency key behavior
- Integration:
  - init/part/complete flow
  - owner checksum dedupe behavior for repeated uploads
  - retry on interrupted upload
  - abort flow
  - embedded Fastify app with in-memory DB and queue mocks (no live Postgres/Redis)

### library-service
- Unit:
  - cursor encode/decode
  - timeline filter builder
- Integration:
  - timeline pagination stability
  - flags update behavior
  - soft delete/restore behavior
  - embedded Fastify app with in-memory DB and queue mocks (no live Postgres/Redis)

### album-sharing-service
- Unit:
  - ACL evaluator
  - share token policy checks
- Integration:
  - album CRUD
  - public link access and revoke
  - invite and family access behavior

### search-service
- Unit:
  - ranking score composer
  - query parser
- Integration:
  - keyword search
  - semantic search with pgvector
  - ACL-filtered results

### worker-service
- Unit:
  - derivative and metadata job handlers
  - retry decision logic
- Integration:
  - queue consume pipeline for media process
  - dead-letter behavior on repeated failures
  - embedded Fastify app with in-memory DB/worker mocks (no live Postgres/Redis)

### ml-service
- Unit:
  - payload validation
  - response schema validation
- Integration:
  - detect/embed/cluster endpoints
  - error behavior on malformed media input

### web-app
- Unit:
  - API client wrappers
  - UI state reducers/hooks
  - multi-file upload scheduler behavior (bounded concurrency and partial failures)
- Integration:
  - auth and timeline data fetch integration
  - upload API interaction and error handling
  - multi-file upload summary and progress behavior
  - timeline modal high-resolution fetch and navigation behavior

---

## 4) Standard Verification Command Set

Use these as baseline; adapt command names to project scripts when introduced.

```bash
# Compose validation
docker compose --env-file .env.example config

# Infra up
docker compose --env-file .env.example up -d postgres redis

# Full stack up
docker compose --env-file .env.example --profile app up -d

# Service logs
docker compose logs --no-color <service> --tail 120

# Service health from container
docker compose exec -T <service> wget -qO- http://127.0.0.1:<port>/health

# Swagger/OpenAPI smoke checks
python3 scripts/smoke_swagger_docs.py

# Pact compatibility checks (service-local npm test workflows)
npm --prefix apps/web test
npm --prefix services/worker test
npm --prefix services/auth test
npm --prefix services/ingest test
npm --prefix services/library test
```

Smoke script behavior notes:
- `scripts/smoke_swagger_docs.py` launches each Node service with `npm start`, waits for `/health` + docs/OpenAPI readiness with bounded retries, and prints captured stdout/stderr tails when startup fails.
- If local dependencies are unavailable (for example Postgres/Redis), only infra/runtime gates that explicitly require them should fail; hermetic integration and contract suites should still run.

Pact execution model:
- `apps/web npm test`: runs unit/integration tests, generates HTTP consumer pacts, publishes pacts to broker.
- `services/worker npm test`: runs unit/integration tests, generates message consumer pacts, publishes pacts to broker, verifies worker provider pacts from broker.
- `services/auth|ingest|library npm test`: runs unit/integration tests, verifies provider pacts from broker, publishes verification results.
- If multiple services share the same test database, do not run these `npm test` commands in parallel. Use sequential contract-only sync to avoid cross-service truncate races:

```bash
PACT_BROKER_BASE_URL=http://localhost:9292 ./scripts/pact-broker-sync.sh
```

Provider verification runtime requirement:
- All provider pact tests now use **embedded Fastify apps with in-memory mock pools** — no running PostgreSQL, Redis, or RabbitMQ is needed.
- Each service's `test/contracts/mockPool.js` provides an in-memory mock of `pg.Pool` that routes SQL patterns to Map-based stores.
- Mock queue adapters are injected via `buildApp()` overrides.
- `PACT_BROKER_BASE_URL` is mandatory for all pact provider verification workflows; tests fail fast when it is missing.
- `PACT_BROKER_BASE_URL` must resolve to a broker URL reachable from the active runtime context (local shell, CI agent, or Docker/container runtime). Avoid `localhost`/`127.0.0.1` inside containerized builds unless the broker is explicitly running in the same container namespace.
- Environment precedence for pact workflows is: explicit process environment -> `.env` -> `.env.example` fallback.
- Consumer pacts include `.given()` provider states that trigger state handlers to seed mock data.
- Any new pact verification flow that requires external runtime dependencies is non-compliant and must be refactored to mock-based verification.

When package test scripts are available, run:

```bash
npm run test
npm run test:integration
pytest -q
```

---

## 5) Failing Gate Protocol

If any gate fails:
- do not mark task done,
- capture failing command output,
- classify failure cause (`code`, `environment`, `test-data`, `contract-drift`),
- provide one recommended fix path,
- re-run full gates after fix.

---

## 6) Evidence Format

Attach this evidence block to each completed task:

```text
GATE RESULTS
G1 Build: pass|fail
G2 Unit: pass|fail
G3 Integration: pass|fail
G4 Contract+Docs: pass|fail
G5 Runtime Health: pass|fail
G6 Verification Artifact: pass|fail
G7 Contract Compatibility: pass|fail

COMMAND LOG
- <command>: pass|fail
- <command>: pass|fail
```
