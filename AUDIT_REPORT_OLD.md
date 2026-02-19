# Comprehensive Code Audit Report: PhotoX

Last updated: 2026-02-16

This report reflects the current repository state after remediation work for:
- transaction and concurrency hardening in ingest complete flow,
- failure-path assembled-file cleanup,
- conflict-safe idempotency persistence behavior.

Deferred items are explicitly tracked in Phase `P100` security tech debt:
- `docs/07-ai-agent-task-contracts.md` (`P100-S1`, `P100-S2`)
- `docs/10-execution-checklists-and-handoffs.md` (Phase `P100` checklist)
- `docs/11-current-implementation-status.md` (`P100` snapshot)

---

## 1. Security Analysis

### 1.1 Insecure Token Storage (Critical)
*   **Status**: **Deferred (P100-S1)**
*   **File**: `apps/web/lib/session.js`
*   **Current state**: Access and refresh tokens are still persisted in browser-readable storage.
*   **Risk**: XSS can exfiltrate tokens and enable account takeover.
*   **Planned remediation**: migrate to cookie-based auth transport (`httpOnly`, `Secure`, `SameSite`) with CSRF controls.

### 1.2 Weak Token Hashing (High)
*   **Status**: **Mitigated**
*   **File**: `services/auth/src/auth/tokens.js`
*   **Current state**: Refresh tokens are hashed and verified with Argon2 only.
*   **Residual risk**: Existing non-Argon2 refresh token hashes are rejected and require user re-authentication.

### 1.3 Denial of Service via Large Payload (High)
*   **Status**: **Mitigated**
*   **Files**: `services/ingest/src/config.js`, `services/ingest/src/app.js`, `services/ingest/src/routes/uploadsRoutes.js`
*   **Current state**: Fastify `bodyLimit` is configured and defaults are aligned with chunk expectations.
*   **Residual risk**: remains bounded by configured limit and request concurrency.

### 1.4 Path Traversal Risk (Medium)
*   **Status**: **Not confirmed as traversal; deferred hardening**
*   **File**: `services/ingest/src/upload/storage.js`
*   **Current state**: file path uses controlled path segments (`userId/year/month/mediaId`) and extension extraction.
*   **Risk posture**: not path traversal in current implementation, but strict extension/MIME allowlisting is still good hardening.
*   **Recommended follow-up**: extension + MIME allowlist and upload-policy documentation.

### 1.5 User Enumeration (Low)
*   **Status**: **Open**
*   **File**: `services/auth/src/routes/authRoutes.js`
*   **Current state**: register endpoint returns explicit `CONFLICT_EMAIL_EXISTS`.
*   **Risk**: allows probing whether an email exists.

---

## 2. Performance and Scalability

### 2.1 Memory Inefficiency in File Assembly (Critical)
*   **Status**: **Fixed**
*   **File**: `services/ingest/src/upload/storage.js`
*   **Current state**: assembly uses streaming read/write, not whole-file buffering per part.

### 2.2 Memory Inefficiency in Checksum Calculation (Critical)
*   **Status**: **Mitigated**
*   **File**: `services/ingest/src/upload/storage.js`
*   **Current state**: checksum computation uses stream-based hashing.

### 2.3 Blocking Event Loop
*   **Status**: **Not confirmed**
*   **File**: `services/ingest/src/upload/storage.js`
*   **Current state**: stream-based APIs are used for assembly and checksum.

---

## 3. Concurrency and Reliability

### 3.1 Race Conditions in File Operations
*   **Status**: **Improved**
*   **Files**: `services/ingest/src/routes/uploadsRoutes.js`, `services/ingest/src/repos/uploadSessionsRepo.js`
*   **Current state**:
    - complete flow now uses row lock (`SELECT ... FOR UPDATE`) and transactional state writes,
    - concurrent complete requests converge on one persisted media/session result.

### 3.2 Database Transaction Boundaries
*   **Status**: **Fixed**
*   **Files**: `services/ingest/src/routes/uploadsRoutes.js`, `services/ingest/src/repos/mediaRepo.js`, `services/ingest/src/repos/uploadSessionsRepo.js`
*   **Current state**: critical complete-flow DB mutations run in a single transaction.

### 3.3 Failure-path Assembled File Cleanup
*   **Status**: **Fixed**
*   **Files**: `services/ingest/src/routes/uploadsRoutes.js`
*   **Current state**: staged assembled output file is removed in `finally` for non-primary paths (including checksum mismatch and dedupe paths).

### 3.4 Idempotency Persistence Conflict Races
*   **Status**: **Fixed**
*   **Files**: `services/ingest/src/repos/idempotencyRepo.js`, `services/ingest/src/routes/uploadsRoutes.js`
*   **Current state**: idempotency persistence uses conflict-safe insert-or-fetch semantics instead of failing on unique constraint races.

---

## 4. Framework-Specific Issues

### 4.1 Missing Service Implementations
*   **Status**: **Partially open**
*   **Services**: `search-service`, `album-sharing-service`, `worker-service`
*   **Current state**: still scaffold-level.

### 4.2 Fastify `trustProxy` Configuration
*   **Status**: **Open**
*   **File**: `services/auth/src/app.js`
*   **Current state**: `trustProxy` not configured.

---

## 5. Code Quality and Maintainability

### 5.1 Hardcoded Secret Defaults in Config
*   **Status**: **Deferred (P100-S2)**
*   **Files**: `services/auth/src/config.js`, `services/ingest/src/config.js`, `services/library/src/config.js`
*   **Current state**: defaults still exist for local-development convenience.
*   **Planned remediation**: production-mode fail-fast validation for weak/missing JWT secrets.

### 5.2 Duplicate Infrastructure Boilerplate
*   **Status**: **Open**
*   **Files**: repeated patterns under `services/*/src/app.js`, `services/*/src/config.js`, `services/*/src/db.js`
*   **Current state**: duplication remains.

---

## 6. Immediate Priorities

1. Execute `P100-S1` (cookie-based auth session migration).
2. Execute `P100-S2` (production JWT secret hard-fail policy).
3. Close remaining open items: user enumeration response policy, `trustProxy`, and service scaffold completion.
