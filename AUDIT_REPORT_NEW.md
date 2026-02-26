# Comprehensive Code Audit Report: PhotoX

**Date:** 2026-02-18
**Auditor:** Senior Software Engineer (Agent)

This report details critical security vulnerabilities, performance bottlenecks, concurrency issues, and code quality findings identified during a comprehensive audit of the PhotoX repository.

---

## 1. Security Analysis

### 1.1. Stored XSS via LocalStorage (Critical)
*   **File:** `apps/web/lib/session.js`
*   **Location:** `writeSession` function (lines ~33-46)
*   **Vulnerability:** The application stores sensitive `accessToken` and `refreshToken` in `localStorage`.
*   **Exploit Scenario:** If an attacker discovers an XSS vulnerability (e.g., via a malicious filename or user input reflected in the DOM), they can execute JavaScript to read `localStorage` and exfiltrate the tokens, leading to full account takeover.
*   **Remediation:** Store tokens in `HttpOnly`, `Secure`, `SameSite` cookies. The frontend should not have access to these tokens directly.
    *   **Corrected Code (Conceptual):**
        ```javascript
        // backend/auth/routes.js
        reply.setCookie('access_token', token, {
          httpOnly: true,
          secure: true, // in production
          sameSite: 'strict',
          path: '/'
        });
        ```

### 1.2. Weak Password Policy Enforcement (High)
*   **File:** `services/auth/src/auth/password.js`
*   **Location:** `validatePassword` function (lines ~8-14)
*   **Vulnerability:** The policy only enforces a minimum length of 8 characters. It does not require complexity (uppercase, lowercase, numbers, special characters).
*   **Exploit Scenario:** Users can set weak passwords (e.g., "password"), making them vulnerable to brute-force and dictionary attacks.
*   **Remediation:** Enforce a stronger policy (min 12 chars, mixed complexity).
    *   **Corrected Code:**
        ```javascript
        function validatePassword(password) {
          if (typeof password !== "string" || password.length < 12) {
             return { ok: false, reason: "Password must be at least 12 characters" };
          }
          if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password)) {
             return { ok: false, reason: "Password must contain uppercase, lowercase, number, and special character" };
          }
          return { ok: true };
        }
        ```

### 1.3. Lack of Rate Limiting on Auth Endpoints (Medium)
*   **File:** `services/auth/src/routes/authRoutes.js`
*   **Location:** `/api/v1/auth/login` and `/api/v1/auth/register` handlers.
*   **Vulnerability:** There is no rate limiting mechanism.
*   **Exploit Scenario:** An attacker can perform high-volume credential stuffing attacks against the login endpoint or exhaust system resources (DB connections, CPU for hashing) via the register endpoint.
*   **Remediation:** Implement rate limiting middleware (e.g., `@fastify/rate-limit`).
    *   **Corrected Code:**
        ```javascript
        // In app.js
        app.register(require('@fastify/rate-limit'), {
          max: 5,
          timeWindow: '1 minute',
          allowList: ['127.0.0.1'] // local dev
        });
        ```

### 1.4. Legacy Password Hash Incompatibility (Low/Bug)
*   **File:** `services/auth/src/auth/password.js`
*   **Location:** `verifyPassword` function (lines ~26-28)
*   **Vulnerability:** The function strictly checks for `!passwordHash.startsWith("$argon2")` and returns `false`.
*   **Impact:** If the system is migrating from a previous system using bcrypt or another algorithm, users will be unable to login until they reset their passwords.
*   **Remediation:** Remove the strict prefix check or add support for legacy algorithms if needed.
    *   **Corrected Code:**
        ```javascript
        async function verifyPassword(password, passwordHash) {
          if (typeof passwordHash !== "string") return false;
          // Support bcrypt if needed, or just let argon2.verify fail gracefully if format is wrong
          try {
            return await argon2.verify(passwordHash, password);
          } catch {
            // Fallback for legacy hashes if implemented
            return false;
          }
        }
        ```

### 1.5. Insecure JWT Defaults (Low)
*   **File:** `services/auth/src/auth/tokens.js`
*   **Location:** `createAccessToken` and `createRefreshToken`.
*   **Vulnerability:** `jwt.sign` relies on the library default algorithm (likely `HS256`).
*   **Exploit Scenario:** While `HS256` is generally safe, relying on defaults can be risky if the library changes or if `None` algorithm attacks become possible due to misconfiguration.
*   **Remediation:** Explicitly specify the algorithm.
    *   **Corrected Code:**
        ```javascript
        jwt.sign(payload, secret, { algorithm: 'HS256', ...options });
        ```

---

## 2. Performance and Scalability

### 2.1. Inefficient Full-Table Scan Search (High)
*   **File:** `services/library/src/repos/libraryRepo.js`
*   **Location:** `listTimeline` query (lines ~68)
*   **Finding:** The search query uses `m.relative_path ILIKE '%' || $9 || '%'`.
*   **Impact:** This forces a full table scan for every search query, which will cause severe performance degradation as the `media` table grows.
*   **Remediation:** Implement Full-Text Search (FTS) using PostgreSQL `tsvector` and `tsquery`, or at least a trigram index (`pg_trgm`) for substring search.
    *   **Corrected Code (SQL):**
        ```sql
        -- Migration
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
        CREATE INDEX idx_media_relative_path_trgm ON media USING gin (relative_path gin_trgm_ops);
        -- Query remains ILIKE, but now uses the index.
        ```

### 2.2. Redundant File Reads in Ingest (Medium)
*   **File:** `services/ingest/src/routes/uploadsRoutes.js`
*   **Location:** `/api/v1/uploads/:uploadId/complete` (lines ~415-430)
*   **Finding:** The code calls `assemblePartsToFile` (which reads/writes all parts) and then immediately calls `checksumFileSha256` (which reads the entire assembled file again).
*   **Impact:** Doubles the I/O requirement for every upload completion, increasing latency and disk load.
*   **Remediation:** Compute the checksum *during* the assembly process using a transform stream or by piping through a hash stream.
    *   **Corrected Code:**
        ```javascript
        // In assemblePartsToFile (storage.js)
        const hash = crypto.createHash("sha256");
        // ... inside loop ...
        input.pipe(hash, { end: false });
        input.pipe(out, { end: false });
        // ... return { path, checksum }
        ```

### 2.3. N+1 File System Calls in Media Content (Medium)
*   **File:** `services/library/src/routes/libraryRoutes.js`
*   **Location:** `/api/v1/media/:mediaId/content` handler.
*   **Finding:** For every request, the code performs `fs.stat` on the derivative path. If it fails (ENOENT), it falls back to `fs.stat` on the original path.
*   **Impact:** High latency and I/O overhead for image-heavy pages (like the timeline).
*   **Remediation:** Store the existence of derivatives in the database (e.g., a `derivatives` JSONB column or separate table) and query it first. Or, trust the file system but avoid the fallback logic that serves massive original files when a thumbnail is requested (which is also a bandwidth issue).

---

## 3. Concurrency and Reliability

### 3.1. Race Condition in Ingest Deduplication (Medium)
*   **File:** `services/ingest/src/routes/uploadsRoutes.js`
*   **Location:** `/api/v1/uploads/:uploadId/complete` (lines ~465-485)
*   **Finding:** The code checks `app.repos.media.findActiveByOwnerAndChecksum` and then conditionally creates a new media record.
*   **Impact:** Two concurrent uploads of the same file could both pass the check and attempt to insert, leading to duplicate media entries or a unique constraint violation error (if one exists).
*   **Remediation:** Rely on a unique database constraint `(owner_id, checksum_sha256)` and handle the conflict error (e.g., `ON CONFLICT DO NOTHING` or catch error code `23505`).
    *   **Corrected Code:**
        ```javascript
        try {
          await app.repos.media.create(...);
        } catch (err) {
          if (err.code === '23505') {
            // Handle as duplicate/dedupe
            return handleDuplicate(...);
          }
          throw err;
        }
        ```

---

## 4. Code Quality and Maintainability

### 4.1. Duplicated Authentication Logic (Low)
*   **Files:** `services/auth/src/auth/guard.js` and `services/library/src/auth/guard.js`.
*   **Finding:** The `requireAccessAuth` middleware and token verification logic are duplicated across services.
*   **Impact:** Logic drift. If a bug is fixed in one, it might be missed in the other.
*   **Remediation:** Extract shared authentication logic into a common internal package or shared library.
