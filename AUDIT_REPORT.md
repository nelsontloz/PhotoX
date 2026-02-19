# Comprehensive Senior-Level Code Audit Report: PhotoX

**Date:** 2026-02-16
**Auditor:** Jules (AI Senior Software Engineer)

This report details the findings of a comprehensive code audit of the PhotoX repository, focusing on security, performance, scalability, concurrency, and code quality.

---

## 1. Security Analysis

### 1.1 Resource Exhaustion (DoS) in User Registration
*   **Severity:** **High**
*   **Location:** `services/auth/src/routes/authRoutes.js`, lines ~103-107
*   **Vulnerability:** The registration endpoint computes the computationally expensive password hash (Argon2) *before* checking if the email is already registered.
*   **Exploit Scenario:** An attacker sends a flood of registration requests with existing emails (or random emails). The server spends significant CPU resources hashing passwords, leading to a Denial of Service (DoS) where legitimate requests are starved.
*   **Remediation:** Check for existing email (cheap operation) before hashing the password (expensive operation).
    ```javascript
    // services/auth/src/routes/authRoutes.js

    // Corrected Code:
    const existingUser = await app.repos.users.findByEmail(email);
    if (existingUser) {
      throw new ApiError(409, "CONFLICT_EMAIL_EXISTS", "Email is already registered");
    }

    // Only hash after verifying uniqueness
    const passwordHash = await hashPassword(body.password);
    // ... create user ...
    ```

### 1.2 Denial of Service (DoS) via Memory Exhaustion in Ingest
*   **Severity:** **High**
*   **Location:** `services/ingest/src/app.js`, lines ~43-49
*   **Vulnerability:** The application configures `parseAs: "buffer"` for `application/octet-stream` uploads. This forces Fastify to buffer the entire request body into memory.
*   **Exploit Scenario:** An attacker uploads a large file (e.g., 5GB) in a single request (or many concurrent large requests). The Node.js process runs out of memory (OOM) and crashes.
*   **Remediation:** Stream the upload directly to disk using `fastify-multipart` or a custom stream handler, avoiding full buffering.
    ```javascript
    // services/ingest/src/app.js

    // Corrected Code:
    // Remove the buffer parser configuration.
    // Use a streaming approach in the route handler, or configure:
    app.addContentTypeParser('application/octet-stream', { parseAs: 'stream' }, (req, body, done) => {
      done(null, body);
    });
    // Update route handler to consume the stream and pipe to disk.
    ```

### 1.3 User Enumeration via Timing Attack
*   **Severity:** **Medium**
*   **Location:** `services/auth/src/routes/authRoutes.js`, lines ~150-160 (Login) and ~243 (Refresh)
*   **Vulnerability:** The login and refresh endpoints return immediately if the user is not found, before performing any cryptographic operations. This timing difference allows an attacker to determine if an email or user ID exists.
*   **Remediation:** Normalize execution time by performing a dummy hash verification when the user is not found.
    ```javascript
    // services/auth/src/routes/authRoutes.js

    // Corrected Code:
    const userRow = await app.repos.users.findByEmail(email);
    // If user not found, use a dummy hash (pre-computed) to simulate work
    const hash toVerify = userRow ? userRow.password_hash : "$argon2id$v=19$m=4096,t=3,p=1$dummy...";
    const passwordMatches = await verifyPassword(body.password, toVerify);

    if (!userRow || !passwordMatches) {
       throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
    }
    ```

### 1.4 Regression: Dropped Support for Legacy Bcrypt Hashes
*   **Severity:** **High** (Functional Regression)
*   **Location:** `services/auth/src/auth/password.js`, lines ~22-24
*   **Issue:** The `verifyPassword` function explicitly requires hashes to start with `$argon2`. This breaks authentication for users with legacy bcrypt hashes, contradicting the requirement to retain support.
*   **Remediation:** Allow bcrypt hashes verification if the prefix matches bcrypt format.
    ```javascript
    // services/auth/src/auth/password.js

    // Corrected Code:
    async function verifyPassword(password, passwordHash) {
      if (typeof passwordHash !== "string") {
        return false;
      }

      if (passwordHash.startsWith("$argon2")) {
        return argon2.verify(passwordHash, password);
      }

      // Fallback for legacy bcrypt (assuming bcrypt library is available)
      // return bcrypt.compare(password, passwordHash);
      // Note: You must re-install/import bcrypt if it was removed.
    }
    ```

### 1.5 Stored XSS Risk via Content-Type Trust
*   **Severity:** **Medium**
*   **Location:** `services/library/src/routes/libraryRoutes.js`, lines ~435 (Serving content)
*   **Vulnerability:** The library service serves files with the `Content-Type` stored in the database. If the Ingest service's MIME detection is bypassed or the DB is compromised, an attacker can upload an HTML file with `text/html` which will execute scripts in the victim's browser when viewed.
*   **Remediation:** Force `Content-Disposition: attachment` for risky MIME types or strictly allowlist `Content-Type` headers served by the Library service (e.g., only `image/*` and `video/*`).
    ```javascript
    // services/library/src/routes/libraryRoutes.js

    // Corrected Code:
    reply.type(contentType);
    if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
       reply.header("Content-Disposition", "attachment");
    }
    ```

### 1.6 Missing Security Headers
*   **Severity:** **Low**
*   **Location:** All Service `app.js` files
*   **Issue:** Services lack standard security headers (HSTS, Content-Security-Policy, X-Frame-Options, etc.).
*   **Remediation:** Use `fastify-helmet` in all Fastify services.

---

## 2. Performance and Scalability

### 2.1 Inefficient Database Sort (No Index Usage)
*   **Severity:** **High**
*   **Location:** `services/library/src/repos/libraryRepo.js`, lines ~53
*   **Issue:** The `listTimeline` query sorts by `COALESCE(mm.taken_at, mm.uploaded_at, m.created_at)`. This computed value prevents the database from using indexes, leading to a full table scan and sort, which will degrade performance as the library grows.
*   **Remediation:** Store the sort key in a dedicated, indexed column (e.g., `sort_at`) populated at ingest time.
    ```sql
    -- Schema Change:
    ALTER TABLE media ADD COLUMN sort_at TIMESTAMPTZ;
    CREATE INDEX idx_media_sort_at ON media (owner_id, sort_at DESC, id DESC);
    -- Query Change:
    SELECT ... FROM media ... ORDER BY sort_at DESC, id DESC;
    ```

### 2.2 Inefficient Full-Text Search
*   **Severity:** **Medium**
*   **Location:** `services/library/src/repos/libraryRepo.js`, lines ~50
*   **Issue:** The query uses `m.relative_path ILIKE '%' || $9 || '%'`. Leading wildcards prevent index usage.
*   **Remediation:** Use PostgreSQL Full-Text Search (`tsvector`/`tsquery`) or a trigram index (`pg_trgm`) for efficient substring search.

### 2.3 Client-Side Memory Exhaustion (OOM)
*   **Severity:** **High**
*   **Location:** `apps/web/lib/upload.js`, `sha256HexFromBlob`
*   **Issue:** The client reads the entire file into an ArrayBuffer (`blob.arrayBuffer()`) to calculate the SHA256 hash. For large video files, this causes the browser tab to crash (OOM).
*   **Remediation:** Use a streaming/chunked hashing approach (e.g., reading file slices and updating a hash state incrementally).

---

## 3. Functionality and Reliability

### 3.1 Missing Auth Token Support for Native Images
*   **Severity:** **Medium**
*   **Location:** `services/library/src/auth/guard.js`
*   **Issue:** The `requireAccessAuth` guard only checks the `Authorization` header. It does not check the `token` query parameter, which is required for loading authenticated images via native `<img>` tags.
*   **Remediation:** Update the guard to accept tokens from the query string.
    ```javascript
    // services/library/src/auth/guard.js

    // Corrected Code:
    const token = extractBearerToken(request.headers.authorization) || request.query.token;
    ```

---

## 4. Code Quality

### 4.1 Duplicated Authentication Logic
*   **Severity:** **Low**
*   **Location:** `services/library/src/auth/guard.js` and `services/ingest/src/auth/guard.js`
*   **Issue:** The authentication guard logic is identical and duplicated across services.
*   **Remediation:** Extract the guard logic into a shared internal package or library to improve maintainability and consistency.

