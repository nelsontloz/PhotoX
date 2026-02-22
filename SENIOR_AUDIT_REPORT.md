# Senior Code Audit Report: PhotoX

**Date:** 2026-02-18
**Auditor:** Senior Software Engineer (Jules)
**Scope:** `services/auth`, `services/ingest`, `services/library`, `apps/web`

## Executive Summary

This audit identifies critical security vulnerabilities and performance bottlenecks in the PhotoX codebase. The most significant findings are Stored Cross-Site Scripting (XSS) risks due to insufficient file type validation and missing security headers, and an Insecure Token Storage mechanism in the frontend. While some issues were previously identified, several remain open or require more robust remediation.

## 1. Security Analysis

### 1.1 Stored XSS via Polyglot File Upload (High)
*   **File:** `services/ingest/src/upload/mediaTypePolicy.js`
*   **Issue:** The file type detection logic relies solely on "magic bytes" (file signature) checks (`detectFromMagicBytes`). This is insufficient as it allows "polyglot" files (e.g., a valid JPEG that also contains malicious HTML/JavaScript) to pass validation.
*   **Impact:** If a user uploads a malicious file and the `library-service` serves it, the browser might execute the embedded script if the Content-Type is not strictly enforced or if the browser performs MIME sniffing.
*   **Remediation:**
    1.  **Strict Content Serving:** The `library-service` must serve files with the `X-Content-Type-Options: nosniff` header to prevent browsers from interpreting non-HTML files as HTML.
    2.  **Robust Detection:** Use a more robust library for file type detection (e.g., `file-type` or `mmmagic`) when dependencies can be added.
    3.  **Content-Security-Policy (CSP):** Implement a strict CSP to restrict script execution.

### 1.2 Missing Security Headers (Medium)
*   **File:** `services/auth/src/app.js`, `services/ingest/src/app.js`, `services/library/src/app.js`
*   **Issue:** The Fastify services lack standard security headers.
*   **Impact:** Increases susceptibility to Clickjacking, XSS, and MIME sniffing attacks.
*   **Remediation:** Implement a global hook to set the following headers:
    ```javascript
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "1; mode=block");
    if (process.env.NODE_ENV === "production") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    ```

### 1.3 Insecure Token Storage (Critical - Deferred)
*   **File:** `apps/web/lib/session.js`
*   **Issue:** Access and Refresh tokens are stored in `localStorage`.
*   **Impact:** Any XSS vulnerability (like the one above) allows attackers to steal tokens and takeover accounts.
*   **Status:** Identified in `AUDIT_REPORT.md` as "Deferred (P100-S1)".
*   **Remediation:** Migrate to `HttpOnly` cookies for token storage.

### 1.4 User Enumeration (Low)
*   **File:** `services/auth/src/routes/authRoutes.js`
*   **Issue:** The `/register` endpoint returns `409 Conflict` if an email already exists.
*   **Impact:** Allows attackers to enumerate registered email addresses.
*   **Remediation:** Return `201 Created` generic response and send a verification email (or mock it) regardless of existence.

### 1.5 Hardcoded Database Credentials (Low)
*   **File:** `services/*/src/config.js`
*   **Issue:** Default `databaseUrl` contains a password. While useful for dev, it risks accidental usage in production if env vars are missing.
*   **Remediation:** Remove the default value or throw an error if `databaseUrl` is missing in `production` mode.

## 2. Performance and Scalability

### 2.1 Inefficient Full-Text Search (Medium)
*   **File:** `services/library/src/repos/libraryRepo.js`
*   **Issue:** The timeline search uses `m.relative_path ILIKE '%' || $9 || '%'`.
*   **Impact:** This forces a full table scan for every search, which will not scale as the library grows.
*   **Remediation:** Implement PostgreSQL Full Text Search.
    *   **Migration:** Add a `tsvector` column to `media` or `media_metadata`.
    *   **Query:** Use `to_tsvector` and `@@` operator.
    ```sql
    -- Example Schema Change
    ALTER TABLE media ADD COLUMN search_vector tsvector;
    UPDATE media SET search_vector = to_tsvector('english', relative_path);
    CREATE INDEX media_search_idx ON media USING GIN (search_vector);

    -- Example Query
    WHERE search_vector @@ plainto_tsquery('english', $9)
    ```

## 3. Concurrency and Reliability

### 3.1 Time-Based User Enumeration (Low)
*   **File:** `services/auth/src/routes/authRoutes.js`
*   **Issue:** The registration flow checks for user existence *before* hashing the password.
*   **Impact:** `findByEmail` (fast) vs `hashPassword` (slow) allows timing attacks to determine if a user exists, even if the 409 status code is fixed.
*   **Remediation:** Always hash a dummy password if the user exists, or use a constant-time lookup flow (though `201` response mitigates the direct leakage).

## 4. Framework-Specific Issues

*   **Fastify:** Missing `helmet` integration (addressed in 1.2).
*   **Next.js:** Missing `next.config.js` for custom headers (e.g., security headers for the frontend itself).

## 5. Code Quality

*   **Duplication:** Authentication logic (`requireAccessAuth`) is duplicated across services. It should be extracted to a shared package.
*   **Type Safety:** JSDoc is used, but TypeScript would provide better compile-time safety and refactoring capabilities.

## 6. Pull Request Awareness

*   `remotes/origin/security/jwt-secret-validation`: Appears to address the JWT secret validation, which is also present in `master`.
*   `remotes/origin/feat/media-sort-at-index`: Addresses performance for timeline sorting.

## Recommended Immediate Actions

1.  **Apply Security Headers:** Manually add the headers hook to all backend services.
2.  **Harden Config:** Enforce `databaseUrl` presence in production.
3.  **Plan Search Optimization:** Schedule the Full Text Search migration.
