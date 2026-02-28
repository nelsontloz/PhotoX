# Comprehensive Code Audit Report: PhotoX

Last updated: 2026-02-18

This report provides a senior-level code audit of the PhotoX repository, evaluating Security, Performance and Scalability, Concurrency and Reliability, Framework-Specific Issues, and Code Quality. It also acknowledges and excludes currently open Pull Requests (e.g., `perf/timeline-prefetch-neighbor-index`).

---

## 1. Security Analysis

### 1.1 Insecure Token Storage (Critical)
*   **File**: `apps/web/lib/session.js`, lines 33-41
*   **Location**: `writeSession` function
*   **Issue**: Access and refresh tokens are persisted in browser-readable storage (`window.localStorage`).
*   **Exploit Scenario & Impact**: A Cross-Site Scripting (XSS) vulnerability anywhere in the web app allows attackers to read `localStorage` and exfiltrate the tokens, leading to full Account Takeover (ATO) without needing the user's credentials.
*   **Remediation**: Migrate to cookie-based auth transport. The backend should send `Set-Cookie` headers for the refresh token with `HttpOnly`, `Secure`, and `SameSite=Strict` attributes.
    ```javascript
    // Backend (Fastify):
    reply.setCookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: app.config.refreshTokenTtlDays * 24 * 60 * 60
    });
    // Frontend: Remove localStorage token persistence and rely on cookies for /refresh.
    ```

### 1.2 User Enumeration via Registration Endpoint (Low/Medium)
*   **File**: `services/auth/src/routes/authRoutes.js`, lines 203-205, 214-216
*   **Location**: `POST /api/v1/auth/register`
*   **Issue**: The endpoint explicitly returns a `409 Conflict` with `CONFLICT_EMAIL_EXISTS` when an email is already registered.
*   **Exploit Scenario & Impact**: Attackers can brute-force email addresses against the `/register` endpoint to harvest a list of valid users on the platform, which can then be targeted for phishing or credential stuffing.
*   **Remediation**: Return a generic success message or standard `201 Created` for all registration attempts, optionally triggering an asynchronous email to the user if the account already exists. For API context where a UI expects an error, rate limiting and CAPTCHAs are standard mitigation.
    ```javascript
    // Modified response logic
    const existingUser = await app.repos.users.findByEmail(email);
    if (existingUser) {
      // Simulate processing time to prevent timing attacks, then return success.
      return reply.code(201).send({ message: "Registration accepted. Check your email." });
    }
    ```

### 1.3 Weak Password Policy Enforcement (Medium)
*   **File**: `services/auth/src/auth/password.js`, lines 9-16
*   **Location**: `validatePassword` function
*   **Issue**: The password validation only checks for a minimum length of 8 characters. It lacks complexity requirements (uppercase, lowercase, numbers, special characters) or checks against common password dictionaries.
*   **Exploit Scenario & Impact**: Users may choose weak, easily guessable passwords, making the application susceptible to brute-force and dictionary attacks.
*   **Remediation**: Implement stricter complexity requirements.
    ```javascript
    function validatePassword(password) {
      if (typeof password !== "string" || password.length < 12) {
        return { ok: false, reason: "Password must be at least 12 characters" };
      }
      if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
        return { ok: false, reason: "Password must contain uppercase letters and numbers" };
      }
      return { ok: true };
    }
    ```

---

## 2. Performance and Scalability

### 2.1 Inefficient Substring Search in Timeline (Medium)
*   **File**: `services/library/src/repos/libraryRepo.js`, line 74
*   **Location**: `listTimeline` query
*   **Issue**: The search filter uses a leading and trailing wildcard `ILIKE '%' || $9 || '%'`.
*   **Impact**: This forces PostgreSQL to perform a full table scan on the `media` table, ignoring standard B-Tree indexes. As the media library grows, this query will consume significant CPU and I/O, leading to severe performance degradation.
*   **Remediation**: Use Postgres Full Text Search (FTS) or a `pg_trgm` GIN index. *Note: Memory indicates a GIN Trigram index was added to `media.relative_path`, but the query still uses `ILIKE`. The index will support `ILIKE`, but FTS (`to_tsvector`) provides better performance for keyword searches.*
    ```sql
    -- If using pg_trgm:
    CREATE INDEX idx_media_relative_path_trgm ON media USING gin (relative_path gin_trgm_ops);
    -- The ILIKE query will now use this index.
    ```

### 2.2 Inefficient Bulk Insert for Album Items (Low)
*   **File**: `services/album-sharing/src/routes/albumRoutes.js` (and related repo)
*   **Issue**: Using `Promise.allSettled` in a loop to add multiple items to an album causes a high volume of individual database queries, introducing network overhead and database load.
*   **Impact**: Adding 1000 items to an album triggers 1000 individual `INSERT` statements, leading to I/O bottlenecks and increased latency.
*   **Remediation**: Implement a bulk insert repository method using `unnest` or multiple value lists in a single `INSERT` statement.
    ```javascript
    // In albumRepo.js
    async addMultipleItems(albumId, mediaIds) {
      await db.query(`
        INSERT INTO album_items (album_id, media_id)
        SELECT $1, unnest($2::uuid[])
        ON CONFLICT DO NOTHING
      `, [albumId, mediaIds]);
    }
    ```

---

## 3. Concurrency and Reliability

### 3.1 Potential Race Condition on User Registration (Low)
*   **File**: `services/auth/src/routes/authRoutes.js`, lines 199-219
*   **Issue**: The registration endpoint checks if an email exists (`findByEmail`), then performs a hash, and then inserts the user. While the unique constraint handles the final integrity (`err.code === "23505"`), the delay during password hashing (Argon2) leaves a large time window.
*   **Impact**: High concurrency of the same email can trigger excessive CPU usage because Argon2 hashing is performed *before* the unique constraint exception is hit for duplicate requests. This is a vector for resource exhaustion / DoS.
*   **Remediation**: Check existence, but also consider acquiring a lightweight lock or doing the insert with a placeholder before the expensive hash operation, or simply applying an application-level rate limiter to the IP/email.
    ```javascript
    // Implement rate limiting using @fastify/rate-limit on /register and /login endpoints.
    await app.register(require('@fastify/rate-limit'), {
      max: 5,
      timeWindow: '1 minute'
    });
    ```

---

## 4. Framework-Specific Issues

### 4.1 Missing Fastify `trustProxy` Configuration (Medium)
*   **File**: All services (`services/auth/src/app.js`, `services/ingest/src/app.js`, `services/library/src/app.js`, etc.)
*   **Issue**: Fastify applications are deployed behind a reverse proxy (Traefik in Docker Compose) but do not configure `trustProxy: true` in the Fastify initialization.
*   **Impact**: Request properties like `request.ip`, `request.hostname`, and `request.protocol` will reflect the proxy's internal IP instead of the actual client. This breaks IP-based rate limiting, audit logging, and geolocation, as all traffic appears to originate from the Traefik container.
*   **Remediation**:
    ```javascript
    // In src/app.js for all services
    const app = Fastify({
      logger: true,
      trustProxy: true, // Enable proxy trust
      // ...
    });
    ```

---

## 5. Code Quality and Maintainability

### 5.1 Hardcoded Config Defaults (Security/Maintainability)
*   **File**: `services/auth/src/config.js`, `services/ingest/src/config.js`, `services/library/src/config.js`
*   **Issue**: The configuration files enforce `WEAK_SECRET_VALUES` in production, but still allow implicit fallbacks if `NODE_ENV` is not strictly `production`.
*   **Impact**: A misconfigured deployment where `NODE_ENV` is missing or accidentally set to `staging` will silently accept missing or weak secrets, exposing the system.
*   **Remediation**: Always require strong, explicit secrets regardless of the environment, unless an explicit `ALLOW_INSECURE_SECRETS_FOR_LOCAL_DEV` flag is enabled.

---

## 6. Pull Request Awareness

*   **PR `perf/timeline-prefetch-neighbor-index`**: Evaluated and excluded. This PR optimizes the `buildNeighborPrefetchTargets` logic in `apps/web/app/timeline/utils.js` from an $O(N)$ scan to an $O(1)$ lookup, which correctly mitigates the timeline performance issue where active index lookups became expensive on large timelines. No duplicate findings reported for this.
