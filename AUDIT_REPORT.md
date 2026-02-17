# Comprehensive Code Audit Report: PhotoX

Last updated: 2026-02-16

This report reflects the current repository state after a comprehensive senior-level audit. It includes previous remediation work and new findings.

Deferred items are explicitly tracked in Phase `P100` security tech debt:
- `docs/04-backlog-epics-stories.md` (`P100-S1`, `P100-S2`)
- `docs/03-implementation-roadmap-90d.md` (Post-90 `P100`)
- `docs/10-execution-checklists-and-handoffs.md` (Phase `P100` checklist)
- `docs/11-current-implementation-status.md` (`P100` snapshot)

---

## 1. Security Analysis

### 1.1 Stored XSS via Unrestricted File Upload (Critical)
*   **Status**: **Open**
*   **Files**: `services/ingest/src/routes/uploadsRoutes.js`, `services/library/src/routes/libraryRoutes.js`
*   **Issue**: `ingest-service` accepts any file type and stores the user-provided `Content-Type`. `library-service` serves the file inline with that `Content-Type`.
*   **Exploit Scenario**: An attacker uploads a malicious HTML file (e.g., `<script>alert(document.cookie)</script>`) as `text/html`. If a victim navigates to the file URL (e.g., via a shared link or direct access), the script executes in the context of the domain.
*   **Impact**: Full XSS, potential session hijacking (if tokens were in cookies, though currently in localStorage which is also vulnerable), actions on behalf of the user.
*   **Remediation**:
    1.  Validate file content (magic bytes) in `ingest-service`.
    2.  Restrict allowed MIME types to images/videos.
    3.  Serve user content from a separate domain (sandbox domain).
    4.  Set `Content-Security-Policy: default-src 'none'`.
    5.  Force `Content-Disposition: attachment` for non-image types.

### 1.2 Insecure Token Storage (Critical)
*   **Status**: **Deferred (P100-S1)**
*   **File**: `apps/web/lib/session.js`
*   **Current state**: Access and refresh tokens are persisted in `localStorage` (browser-readable storage).
*   **Risk**: XSS vulnerabilities (like 1.1) can easily exfiltrate tokens and enable account takeover.
*   **Planned remediation**: Migrate to `httpOnly`, `Secure`, `SameSite` cookies for token transport.

### 1.3 Missing Security Headers (Medium)
*   **Status**: **Open**
*   **Files**: `services/*/src/app.js` (e.g., `services/library/src/app.js`)
*   **Issue**: Fastify services do not use `@fastify/helmet` or set security headers.
*   **Impact**: Missing protections against XSS (`Content-Security-Policy`), Clickjacking (`X-Frame-Options`), MIME sniffing (`X-Content-Type-Options`), etc.
*   **Remediation**: Integrate `@fastify/helmet` with strict CSP.

### 1.4 Weak Password Policy (Medium)
*   **Status**: **Open**
*   **File**: `services/auth/src/routes/authRoutes.js`
*   **Issue**: `registerBodySchema` only enforces `minLength: 8`. No complexity requirements.
*   **Impact**: Users may set weak passwords susceptible to brute-force or dictionary attacks.
*   **Remediation**: Enforce complexity (uppercase, lowercase, numbers, symbols) or use a compromised password check (e.g., Pwned Passwords).

### 1.5 No Rate Limiting on Auth Endpoints (Medium)
*   **Status**: **Open**
*   **File**: `services/auth/src/routes/authRoutes.js`
*   **Issue**: Endpoints `/login` and `/register` lack visible rate limiting middleware.
*   **Impact**: Susceptible to brute-force attacks on credentials and DoS.
*   **Remediation**: specific rate limiting (e.g., `@fastify/rate-limit`) on these routes.

### 1.6 User Enumeration (Low)
*   **Status**: **Open**
*   **File**: `services/auth/src/routes/authRoutes.js`
*   **Current state**: Register endpoint returns explicit `CONFLICT_EMAIL_EXISTS` (409).
*   **Risk**: Allows probing whether an email exists in the system.
*   **Remediation**: Return a generic "If the email is valid, a confirmation link has been sent" (if email verification exists) or similar generic message, though this affects UX.

### 1.7 Weak Token Hashing (Mitigated)
*   **Status**: **Mitigated**
*   **File**: `services/auth/src/auth/tokens.js`
*   **Current state**: Refresh tokens are hashed and verified with Argon2. Legacy hashes are rejected.

---

## 2. Performance and Scalability

### 2.1 Inefficient Timeline Query (High)
*   **Status**: **Open**
*   **File**: `services/library/src/repos/libraryRepo.js`
*   **Issue**: `listTimeline` uses `ORDER BY COALESCE(mm.taken_at, mm.uploaded_at, m.created_at) DESC`. This computed sort key prevents index usage for sorting, likely causing full table scans and memory sorts.
*   **Impact**: Query performance will degrade linearly (or worse) with dataset size.
*   **Remediation**: Add a persisted `sort_at` column to `media` (or `media_metadata`) that is pre-calculated on insert/update. Index this column for efficient pagination.

### 2.2 Inefficient Full Text Search (Medium)
*   **Status**: **Open**
*   **File**: `services/library/src/repos/libraryRepo.js`
*   **Issue**: `listTimeline` uses `m.relative_path ILIKE '%' || $9 || '%'`. Leading wildcards prevent B-tree index usage.
*   **Impact**: Full table scan for every search query.
*   **Remediation**: Use `pg_trgm` (trigram) extension and GIN index for efficient substring search.

### 2.3 Memory Inefficiency (Mitigated)
*   **Status**: **Fixed**
*   **File**: `services/ingest/src/upload/storage.js`
*   **Previous Issue**: Whole-file buffering.
*   **Current state**: Fixed. Uses streaming read/write for file assembly and checksums.

---

## 3. Concurrency and Reliability

### 3.1 Race Conditions in File Operations (Fixed)
*   **Status**: **Fixed**
*   **Files**: `services/ingest/src/routes/uploadsRoutes.js`
*   **Current state**: Complete flow uses `SELECT ... FOR UPDATE` and transactions.

### 3.2 Idempotency Persistence (Fixed)
*   **Status**: **Fixed**
*   **Files**: `services/ingest/src/repos/idempotencyRepo.js`
*   **Current state**: Uses conflict-safe insert-or-fetch.

---

## 4. Framework-Specific Issues

### 4.1 Fastify `trustProxy` Configuration
*   **Status**: **Open**
*   **File**: `services/auth/src/app.js` (and others)
*   **Issue**: `trustProxy` is not configured, but the service runs behind Traefik (Docker Compose).
*   **Impact**: `request.ip` may be incorrect (internal Docker IP), affecting rate limiting and logging.
*   **Remediation**: Configure `trustProxy: true` or to the specific Traefik subnet.

### 4.2 Missing Service Implementations
*   **Status**: **Partially open**
*   **Services**: `search-service`, `album-sharing-service`, `worker-service` remain scaffold-level.

---

## 5. Code Quality and Maintainability

### 5.1 Duplicated Auth Logic
*   **Status**: **Open**
*   **Files**: `services/*/src/auth/guard.js`
*   **Issue**: `requireAccessAuth` logic is duplicated across services.
*   **Impact**: Maintenance burden. Security fixes in one might be missed in others.
*   **Remediation**: Extract to a shared internal package or git submodule.

### 5.2 Hardcoded Secret Defaults
*   **Status**: **Deferred (P100-S2)**
*   **Files**: `services/*/src/config.js`
*   **Current state**: Defaults exist for dev convenience.
*   **Remediation**: Fail-fast in production if secrets are missing.
