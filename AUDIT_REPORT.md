# Comprehensive Senior-Level Code Audit Report

**Date:** 2026-02-18
**Target:** PhotoX Repository
**Auditor:** Jules (AI Senior Software Engineer)

---

## 1. Security Analysis

### 1.1. Insecure Password Policy (Medium)
*   **File:** `services/auth/src/auth/password.js`
*   **Location:** Line 10 (approx), `validatePassword` function.
*   **Issue:** The password policy only enforces a minimum length of 8 characters. It lacks complexity checks (uppercase, lowercase, numbers, symbols) and common password blocklisting.
*   **Exploit Scenario:** An attacker can easily guess simple 8-character passwords (e.g., "password") via brute-force or dictionary attacks.
*   **Impact:** Account takeover.
*   **Remediation:**
    ```javascript
    function validatePassword(password) {
      if (typeof password !== "string" || password.length < 12) { // Increased length
        return { ok: false, reason: "Password must be at least 12 characters" };
      }
      // Add zxcvbn or similar entropy check in a real implementation
      return { ok: true };
    }
    ```

### 1.2. Weak JWT Signing Algorithm Default (Low)
*   **File:** `services/auth/src/auth/tokens.js`
*   **Location:** Lines 17 and 32, `jwt.sign` calls.
*   **Issue:** `jwt.sign` is called without an explicit `algorithm` option. While it defaults to HS256 (which is used here), explicit declaration prevents "algorithm confusion" attacks if the library defaults change or if dynamic algorithms are ever introduced.
*   **Exploit Scenario:** Unlikely with current hardcoded secrets, but if the verification logic allowed `none` algo, an attacker could forge tokens.
*   **Impact:** Authentication bypass.
*   **Remediation:** Always specify `{ algorithm: 'HS256' }` in `jwt.sign` and `jwt.verify`.

### 1.3. User Enumeration via Registration (Low)
*   **File:** `services/auth/src/routes/authRoutes.js`
*   **Location:** Line 240, `app.post("/api/v1/auth/register", ...)`
*   **Issue:** The endpoint returns `409 CONFLICT` with code `CONFLICT_EMAIL_EXISTS` when an email is already taken.
*   **Exploit Scenario:** An attacker can check if a specific user (e.g., `admin@company.com`) has an account on the platform.
*   **Impact:** Privacy leak; aids in targeted phishing or brute-force campaigns.
*   **Remediation:** Return `201 Created` generic message even if the user exists, and send an email notification instead. (Trade-off: UX friction for legitimate users).

### 1.4. Insecure Token Storage in Frontend (High)
*   **File:** `apps/web/lib/session.js`
*   **Location:** Line 43, `window.localStorage.setItem(SESSION_STORAGE_KEY, ...)`
*   **Issue:** Access and refresh tokens are stored in `localStorage`.
*   **Exploit Scenario:** Any XSS vulnerability in the application (or dependencies) allows an attacker to dump `localStorage`, steal the refresh token, and impersonate the user persistently.
*   **Impact:** Account takeover.
*   **Remediation:** Store tokens in `HttpOnly`, `Secure`, `SameSite=Strict` cookies. The frontend should not have access to the raw tokens.

### 1.5. Command Injection Risk (Low/Mitigated)
*   **File:** `services/worker/src/media/derivatives.js`
*   **Location:** Line 113, `commandRunner("ffmpeg", ...)`
*   **Issue:** `execFile` is used. While safer than `exec`, if any argument is purely user-controlled and unsanitized, it could be risky.
*   **Analysis:** The `relativePath` is resolved via `resolveAbsolutePath` which prevents traversal. Arguments like `-vf` are constructed internally. Risk is low but requires vigilance.
*   **Remediation:** Ensure strict validation of all inputs before passing to `commandRunner`.

### 1.6. Missing Rate Limiting (Medium)
*   **File:** `services/auth/src/app.js`
*   **Issue:** No rate-limiting middleware (e.g., `@fastify/rate-limit`) is registered.
*   **Exploit Scenario:** Attacker floods `/api/v1/auth/login` to brute-force passwords or `/api/v1/auth/register` to exhaust database resources.
*   **Impact:** DoS, Brute-force success.
*   **Remediation:** Register `@fastify/rate-limit` globally or on auth routes.

---

## 2. Performance and Scalability

### 2.1. Inefficient Database Search (High)
*   **File:** `services/library/src/repos/libraryRepo.js`
*   **Location:** Line 60, `m.relative_path ILIKE '%' || $9 || '%'`
*   **Issue:** Leading wildcard `ILIKE` query prevents the use of standard B-Tree indexes, forcing a full table scan on the `media` table for every search.
*   **Bottleneck:** CPU and I/O on PostgreSQL as the dataset grows.
*   **Remediation:** Implement Full-Text Search using `tsvector` and `GIN` indexes, or use `pg_trgm` extension for trigram indexes to support substring search efficiently.

### 2.2. Potential N+1 Query in User Listing (Medium)
*   **File:** `services/auth/src/repos/usersRepo.js`
*   **Location:** `listUsersWithStats`
*   **Issue:** The query performs a subquery `SELECT m.owner_id, COUNT(*) ... GROUP BY m.owner_id` joined to the users table. While not strictly N+1 in code (it's one SQL query), it aggregates the *entire* media table for *every* user listing page view if not carefully optimized by the query planner.
*   **Bottleneck:** DB CPU usage.
*   **Remediation:** Maintain a materialized counter on the `users` table (`upload_count`) updated via triggers or background jobs.

### 2.3. Synchronous File Operations (Low)
*   **File:** `services/ingest/src/upload/storage.js`
*   **Location:** Line 110, `fsSync.createReadStream`
*   **Issue:** Mixing `fsSync` streams with async logic is generally fine, but `assemblePartsToFile` could block the event loop if the file IO is heavy.
*   **Remediation:** Ensure all file IO uses `fs.promises` or non-blocking streams where possible.

---

## 3. Concurrency and Reliability

### 3.1. Database Locking Strategy (Good but Heavy)
*   **File:** `services/auth/src/repos/usersRepo.js`
*   **Location:** Line 17, `SELECT pg_advisory_xact_lock($1)`
*   **Issue:** Registration is serialized globally using a hardcoded magic number lock (`947311`). This is done to ensure the "first user is admin" logic is race-free.
*   **Impact:** Limits registration throughput significantly.
*   **Remediation:** Use `INSERT ... ON CONFLICT` or check the admin count in a more optimistic way. Alternatively, define the admin user via environment variables/seed scripts.

### 3.2. Race Condition in Upload Completion (Mitigated)
*   **File:** `services/ingest/src/routes/uploadsRoutes.js`
*   **Location:** Line 427, `SELECT ... FOR UPDATE`
*   **Analysis:** The code correctly uses row-level locking to prevent concurrent completion requests for the same upload ID. This is a positive finding.

### 3.3. Duplicate Infrastructure Logic
*   **Issue:** `requireAccessAuth` and database connection logic are duplicated across `auth`, `ingest`, `library`, and `worker` services.
*   **Impact:** Fixes to auth logic must be applied in 4 places. Increases risk of drift.
*   **Remediation:** Extract common logic to a shared internal package (e.g., `packages/common`).

---

## 4. Framework-Specific Issues

### 4.1. Fastify Trust Proxy Misconfiguration (Medium)
*   **File:** `services/*/src/app.js`
*   **Issue:** `trustProxy` is not configured.
*   **Impact:** If deployed behind a reverse proxy (like Traefik/Nginx in Docker), `request.ip` will likely be the internal Docker IP, breaking rate limiting and logging.
*   **Remediation:** Set `trustProxy: true` (or specific IPs) in Fastify config.

### 4.2. Hardcoded Secrets in Config (Low)
*   **File:** `services/*/src/config.js`
*   **Issue:** Defaults like `"change-me"` are present.
*   **Analysis:** There is logic to throw an error in `production` if these are used, which is good practice.
*   **Remediation:** Ensure CI/CD pipelines inject real secrets.

---

## 5. Code Quality and Maintainability

### 5.1. Magic Numbers
*   **File:** `services/auth/src/repos/usersRepo.js`
*   **Location:** Line 17.
*   **Issue:** `947311` is an arbitrary integer for the advisory lock.
*   **Remediation:** Move to a named constant `REGISTRATION_LOCK_ID`.

### 5.2. Error Swallowing
*   **File:** `services/auth/src/auth/password.js`
*   **Location:** `verifyPassword` function.
*   **Issue:** The `try/catch` block returns `false` on *any* error from `argon2.verify`, masking potential configuration or library errors.
*   **Remediation:** Log the error before returning `false`.

### 5.3. Frontend Dependency on specific Font URL
*   **File:** `apps/web/app/layout.js`
*   **Issue:** The Material Symbols URL is extremely long and hardcoded with a specific list of icons (`&icon_names=...`). Adding a new icon requires manually updating this URL.
*   **Remediation:** Use a self-hosted font or a package wrapper to manage icons more maintainably.

---

## 6. Summary

The codebase is generally well-structured with good separation of concerns (microservices). However, **Security** needs attention regarding password policies and token storage (XSS risk). **Performance** will degrade with dataset size due to inefficient search queries. **Maintainability** is impacted by code duplication across services.

**Top 3 Priorities:**
1.  **Migrate Auth Tokens:** Move from `localStorage` to HttpOnly cookies.
2.  **Optimize Search:** Replace `ILIKE %...%` with Full-Text Search.
3.  **Centralize Shared Logic:** Create a shared library for Auth and DB code.
