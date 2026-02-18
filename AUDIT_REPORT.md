# Comprehensive Code Audit Report

## 1. Security Analysis

### 1.1. Denial of Service (DoS) via Memory Exhaustion in Ingest Service
- **File:** `services/ingest/src/app.js` (Line 41-49)
- **Vulnerability:** Unbounded Memory Allocation
- **Description:** The ingest service configures the body parser for `application/octet-stream` to buffer the entire request body into memory:
  ```javascript
  app.addContentTypeParser(
    "application/octet-stream",
    {
      parseAs: "buffer"
    },
    function parseOctetStream(_request, body, done) {
      done(null, body);
    }
  );
  ```
  This allows an attacker to send multiple large requests concurrently (up to the configured `bodyLimit`), rapidly exhausting the server's available RAM and causing a Denial of Service. While the limit prevents individual large payloads, concurrent requests can still overwhelm the heap.
- **Impact:** Service unavailability, potential OOM crashes.
- **Remediation:** Do not buffer the entire body. Use a streaming approach or a library like `fastify-multipart` (or `busboy` directly) to process the stream as it arrives.
  ```javascript
  // Corrected approach (conceptual):
  app.addContentTypeParser(
    "application/octet-stream",
    function parseOctetStream(request, payload, done) {
      // payload is a stream here
      done(null, payload);
    }
  );
  // Update route handler to consume the stream
  ```

### 1.2. Stored XSS Risk via LocalStorage
- **File:** `apps/web/lib/session.js` (Lines 16, 32)
- **Vulnerability:** Insecure Token Storage
- **Description:** JWT Access and Refresh tokens are stored in `localStorage`.
  ```javascript
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
  ```
  If an attacker successfully exploits an XSS vulnerability in the application (e.g., via a malicious filename or metadata that isn't properly sanitized), they can read `localStorage` and exfiltrate the tokens, gaining persistent access to the user's account.
- **Impact:** Account takeover.
- **Remediation:** Store Refresh Tokens in `HttpOnly`, `Secure`, `SameSite` cookies. Access tokens can be kept in memory (closure variable) and refreshed silently using the cookie when needed.

### 1.3. User Enumeration via Timing Attack
- **File:** `services/auth/src/routes/authRoutes.js` (Lines 152-156 vs 160-163)
- **Vulnerability:** Timing Attack
- **Description:** The login route returns immediately if the user is not found, but performs an expensive `argon2.verify` operation if the user exists.
  ```javascript
  const userRow = await app.repos.users.findByEmail(email);
  if (!userRow) {
    throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
  }
  // ...
  const passwordMatches = await verifyPassword(body.password, userRow.password_hash);
  ```
  An attacker can measure the response time to determine if an email address is registered.
- **Impact:** User enumeration, privacy violation.
- **Remediation:** Ensure the response time is roughly consistent regardless of whether the user exists.
  ```javascript
  // Corrected Code:
  const userRow = await app.repos.users.findByEmail(email);
  const fakeHash = "$argon2id$v=19$m=65536,t=3,p=4$...+..."; // Pre-calculated dummy hash
  const hashToVerify = userRow ? userRow.password_hash : fakeHash;
  const passwordMatches = await verifyPassword(body.password, hashToVerify);

  if (!userRow || !passwordMatches) {
     throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
  }
  ```

### 1.4. Resource Exhaustion in Registration
- **File:** `services/auth/src/routes/authRoutes.js` (Lines 114-123)
- **Vulnerability:** CPU Exhaustion
- **Description:** The registration route hashes the password (expensive Argon2 operation) *before* checking if the email is already registered.
  ```javascript
  const passwordHash = await hashPassword(body.password);
  // ...
  try {
    const userRow = await app.repos.users.createUserForRegistration(...);
  } catch (err) {
    // Check for conflict
  }
  ```
  An attacker can flood the server with registration requests using existing emails. The server will spend significant CPU hashing passwords before rejecting the requests due to email conflict.
- **Impact:** CPU exhaustion, Denial of Service.
- **Remediation:** Check if the email exists before hashing the password.
  ```javascript
  // Corrected Code:
  const existingUser = await app.repos.users.findByEmail(body.email);
  if (existingUser) {
    throw new ApiError(409, "CONFLICT_EMAIL_EXISTS", "Email is already registered");
  }
  const passwordHash = await hashPassword(body.password);
  ```

### 1.5. Missing Security Headers
- **File:** `services/auth/src/app.js`, `services/ingest/src/app.js`, `services/library/src/app.js`
- **Vulnerability:** Missing Security Configuration
- **Description:** The Fastify applications do not register `fastify-helmet` or similar middleware to set standard security headers (HSTS, X-Content-Type-Options, X-Frame-Options, Content-Security-Policy).
- **Impact:** Increased susceptibility to Clickjacking, XSS, and MIME sniffing attacks.
- **Remediation:** Install and register `@fastify/helmet` in all service `app.js` files.

---

## 2. Performance and Scalability

### 2.1. Inefficient Timeline Query
- **File:** `services/library/src/repos/libraryRepo.js` (Lines 46-60)
- **Issue:** Full Table Sort / Missing Index Usage
- **Description:** The timeline query sorts by a calculated value:
  ```sql
  ORDER BY COALESCE(mm.taken_at, mm.uploaded_at, m.created_at) DESC, m.id DESC
  ```
  This prevents the database from using an index for sorting, forcing a sort of the entire result set (or a large portion of it) for every query. As the library grows, this query will become extremely slow.
- **Impact:** High latency on the main timeline view, high database CPU usage.
- **Remediation:** Add a generated column (stored) to the `media_metadata` or `media` table that persists this coalesced value, and index it.
  ```sql
  -- Migration:
  ALTER TABLE media ADD COLUMN sort_at TIMESTAMPTZ GENERATED ALWAYS AS (COALESCE(taken_at, created_at)) STORED;
  CREATE INDEX idx_media_sort_at ON media (owner_id, sort_at DESC, id DESC);
  ```

### 2.2. Full Table Scans in Search
- **File:** `services/library/src/repos/libraryRepo.js` (Line 42)
- **Issue:** Non-SARGable Query
- **Description:** The search functionality uses a leading wildcard `ILIKE`:
  ```sql
  m.relative_path ILIKE '%' || $9 || '%'
  ```
  Standard B-Tree indexes cannot be used for leading wildcards, forcing a sequential scan of the `media` table.
- **Impact:** Poor search performance as the dataset grows.
- **Remediation:** Use PostgreSQL Full Text Search (`tsvector`/`tsquery`) or a Trigram index (`pg_trgm`) for efficient substring search.
  ```sql
  -- Remediation with pg_trgm:
  CREATE EXTENSION pg_trgm;
  CREATE INDEX idx_media_path_trgm ON media USING gin (relative_path gin_trgm_ops);
  -- Query remains similar, but now uses the index.
  ```

### 2.3. Client-Side OOM Risk
- **File:** `apps/web/lib/upload.js` (Lines 4-7)
- **Issue:** Memory Exhaustion on Client
- **Description:** The `sha256HexFromBlob` function reads the entire file into an `ArrayBuffer` to calculate the checksum.
  ```javascript
  const bytes = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  ```
  If a user tries to upload a large video file (e.g., several GBs), this will likely crash the browser tab due to Out Of Memory (OOM) error.
- **Impact:** Inability to upload large files, poor user experience.
- **Remediation:** Implement incremental (streaming) hashing using a library (e.g., `crypto-js` or a web-compatible implementation) that processes the file in chunks (e.g., 5MB at a time).

---

## 3. Code Quality and Maintainability

### 3.1. Duplicate Authentication Logic
- **Files:**
  - `services/auth/src/auth/guard.js`
  - `services/ingest/src/auth/guard.js`
  - `services/library/src/auth/guard.js`
- **Issue:** Code Duplication (DRY Violation)
- **Description:** The `requireAccessAuth` middleware is identical across three services. Any change to auth logic (e.g., adding a new token type or claim check) requires updates in three places, increasing the risk of inconsistency and bugs.
- **Remediation:** Extract the shared auth logic into a common internal package or a shared git submodule/library that can be imported by all services.

### 3.2. Hardcoded Secrets in Development Config
- **Files:** `*/src/config.js`
- **Issue:** Weak Defaults
- **Description:** While the code checks for weak secrets in production, the default values are hardcoded in the source code.
  ```javascript
  jwtAccessSecret: overrides.jwtAccessSecret || "change-me"
  ```
  This can lead to accidental deployment with default secrets if the environment validation logic fails or is bypassed.
- **Remediation:** Do not provide default values for secrets in the code. Require them to be present in the environment, even in development (use a `.env.example` file).

### 3.3. Lack of Rate Limiting
- **Issue:** Missing Protection
- **Description:** None of the services (especially `auth-service`) appear to have rate limiting configured.
- **Impact:** Vulnerability to brute-force attacks on login/registration and DoS attacks on API endpoints.
- **Remediation:** Implement `@fastify/rate-limit` on public-facing endpoints, particularly `/auth/login` and `/auth/register`.
