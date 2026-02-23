# comprehensive Senior-Level Code Audit Report: PhotoX

**Date:** 2026-02-18
**Auditor:** Jules (AI Software Engineer)

This report details findings from a comprehensive senior-level code audit of the PhotoX repository, covering Security, Performance, Concurrency, Framework Issues, and Code Quality.

---

## 1. Security Analysis

### 1.1 User Enumeration via Registration Endpoint (Low)
*   **File:** `services/auth/src/routes/authRoutes.js` (Line ~90)
*   **Vulnerability:** The registration endpoint explicitly returns `409 CONFLICT_EMAIL_EXISTS` when an email is already registered.
    ```javascript
    if (existingUser) {
      throw new ApiError(409, "CONFLICT_EMAIL_EXISTS", "Email is already registered");
    }
    ```
*   **Exploit Scenario:** An attacker can enumerate valid email addresses by attempting to register with a list of emails and checking for 409 responses versus 201 (success).
*   **Remediation:** Return `201 Created` even if the user exists (silent failure) and send an email notification instead, or use a generic error message. Given this is a personal edition, this might be acceptable, but for a public-facing app, it's a risk.
*   **Note:** This is marked as "Open" in the previous audit report.

### 1.2 Missing Security Headers (Medium)
*   **Files:**
    - `services/auth/src/app.js`
    - `services/ingest/src/app.js`
    - `services/library/src/app.js`
    - `apps/web/next.config.js` (Missing)
*   **Vulnerability:** Backend services do not implement standard security headers (e.g., via `fastify-helmet`). The frontend lacks `next.config.js` to set headers like CSP, HSTS, X-Frame-Options.
*   **Exploit Scenario:** Increases risk of XSS, Clickjacking, and other browser-based attacks.
*   **Remediation:**
    - Backend: Install and register `@fastify/helmet`.
    - Frontend: Create `next.config.js` and configure `headers()` to set strictly necessary security headers.

### 1.3 Insecure Token Storage (High)
*   **File:** `apps/web/lib/session.js` (Line 1)
*   **Vulnerability:** JWT Access and Refresh tokens are stored in `localStorage` (`photox.session.v1`).
    ```javascript
    const SESSION_STORAGE_KEY = "photox.session.v1";
    // ...
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
    ```
*   **Exploit Scenario:** If an attacker achieves XSS on the frontend, they can easily read `localStorage` and exfiltrate the tokens, leading to full account takeover.
*   **Remediation:** Store refresh tokens in `httpOnly` cookies. Access tokens can be kept in memory or also in `httpOnly` cookies (BFF pattern).
*   **PR Awareness:** Deferred as `P100-S1` in `AUDIT_REPORT.md`.

### 1.4 Strict Password Hashing Check (Low/Compat)
*   **File:** `services/auth/src/auth/password.js` (Line 23)
*   **Issue:** `verifyPassword` strictly checks for `$argon2` prefix.
    ```javascript
    if (typeof passwordHash !== "string" || !passwordHash.startsWith("$argon2")) {
      return false;
    }
    ```
*   **Impact:** If the system migrates from another hashing algorithm (e.g., bcrypt), existing users will be unable to login without a password reset.
*   **Remediation:** Allow other prefixes if backward compatibility is needed, or ensure migration strategy is in place.
*   **PR Awareness:** Branch `origin/fix-bcrypt-truncation-vulnerability-argon2...` might be related to hashing improvements.

### 1.5 Custom Magic Bytes Detection (Low)
*   **File:** `services/ingest/src/upload/mediaTypePolicy.js`
*   **Issue:** Custom implementation of `detectFromMagicBytes` instead of using a standard library like `file-type`.
*   **Risk:** Maintenance burden and potential for missed edge cases in file signature detection.
*   **Remediation:** Replace with `file-type` or similar established library.

### 1.6 Missing `trustProxy` Configuration (Low)
*   **Files:** `services/*/src/app.js`
*   **Issue:** Fastify instances are created without `trustProxy` configuration, but the architecture uses Traefik as a gateway.
*   **Risk:** `request.ip` will likely be the internal IP of the Traefik container rather than the real client IP. This affects logging and rate limiting.
*   **Remediation:** Configure `trustProxy: true` (or specific IPs) in `Fastify()` options.

---

## 2. Performance and Scalability

### 2.1 Full Table Scan on Search (High)
*   **File:** `services/library/src/repos/libraryRepo.js` (Line 59)
*   **Issue:** The search query uses a leading wildcard `ILIKE`.
    ```sql
    AND ($9::text IS NULL OR m.relative_path ILIKE '%' || $9 || '%')
    ```
*   **Impact:** Postgres cannot use standard B-Tree indexes for leading wildcards. This forces a full table scan for every search, which will not scale as the library grows.
*   **Remediation:** Use Postgres Full Text Search (`tsvector`/`tsquery`) or a Trigram index (`pg_trgm`) for efficient substring search.
*   **PR Awareness:** Branch `origin/feat/media-sort-at-index` might address some indexing, but specifically `origin/impl-gin-trigram` (if it existed) would be relevant. The current branches don't explicitly name full-text search.

### 2.2 Inefficient Checksum Calculation (Medium)
*   **File:** `services/ingest/src/routes/uploadsRoutes.js` (Line 432)
*   **Issue:** The `complete` handler assembles the file (write to disk), then reads it back to calculate checksum.
    ```javascript
    outputAbsolutePath = await assemblePartsToFile(...)
    const actualChecksum = await checksumFileSha256(outputAbsolutePath);
    ```
*   **Impact:** Double I/O for the entire file size.
*   **Remediation:** Calculate the running SHA256 hash *during* the assembly process (piping through a crypto hash stream) to avoid the second read.
*   **PR Awareness:** Branch `origin/refactor/chunked-sha256-2012083340578563855` likely addresses this or related hashing logic.

### 2.3 Frontend Blocking Hash (Medium)
*   **File:** `apps/web/lib/upload.js` (Line 48)
*   **Issue:** `uploadMediaInChunks` calculates the full file hash *before* starting the upload.
    ```javascript
    const checksumSha256 = await sha256HexFromBlob(file);
    const initResult = await initUpload(...)
    ```
*   **Impact:** For large files (e.g., GBs of video), the user waits significantly before any network activity occurs. It also consumes CPU on the main thread (even if chunked).
*   **Remediation:** Stream the hash calculation as parts are uploaded, or use a web worker. However, the API currently requires the checksum at `init`.
*   **PR Awareness:** Branch `origin/feat/web-upload-streaming-hash-cors-dev` seems to be addressing exactly this.

---

## 3. Concurrency and Reliability

### 3.1 Robust Upload Completion (Positive Finding)
*   **File:** `services/ingest/src/routes/uploadsRoutes.js`
*   **Observation:** The use of `findByIdForUserForUpdate` (SELECT ... FOR UPDATE) and transactions during the upload completion phase correctly handles race conditions where multiple requests might try to complete the same upload simultaneously. This is a good implementation.

---

## 4. Framework-Specific Issues

### 4.1 Missing Next.js Config
*   **File:** `apps/web/next.config.js`
*   **Issue:** File is missing.
*   **Impact:** Default Next.js configuration is used. No security headers, no customized image optimization domains, etc.
*   **Remediation:** Create the file and configure strict headers.

---

## 5. Code Quality and Maintainability

### 5.1 Duplicated Auth Logic
*   **Files:**
    - `services/auth/src/auth/guard.js`
    - `services/ingest/src/auth/guard.js`
    - `services/library/src/auth/guard.js`
*   **Issue:** `requireAccessAuth` is copy-pasted across services.
*   **Impact:** Updates to auth logic (e.g., changing token structure) require changes in multiple places, increasing risk of drift.
*   **Remediation:** Extract to a shared internal package or a git submodule.

### 5.2 Minor Indentation Issue
*   **File:** `services/auth/src/routes/authRoutes.js` (Logout handler)
*   **Issue:** The body of the async function is not indented correctly relative to the function declaration.
*   **Remediation:** Format the code.

---

## 6. Pull Request (Branch) Awareness

The following open branches appear to address some of the findings:

*   **`origin/feat/web-upload-streaming-hash-cors-dev`**: Likely addresses **2.3 Frontend Blocking Hash**.
*   **`origin/security/jwt-secret-validation`**: Addresses weak secret configuration (noted in previous reports).
*   **`origin/feat/media-sort-at-index`**: Likely improves sorting performance in Library service.
*   **`origin/refactor/chunked-sha256...`**: Likely addresses **2.2 Inefficient Checksum Calculation**.
*   **`origin/fix-bcrypt-truncation-vulnerability-argon2...`**: Likely addresses password hashing compatibility or security.

**Conclusion:**
The codebase is generally well-structured with good separation of concerns. The primary risks are currently around **Frontend Token Storage (XSS)**, **Search Performance**, and **Missing Security Headers**. The **Upload Performance** issues are significant for large files but appear to be work-in-progress.
