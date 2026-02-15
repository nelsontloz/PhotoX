# Comprehensive Code Audit Report: PhotoX

## 1. Security Analysis

### 1.1 Insecure Token Storage (Critical)
*   **File**: `apps/web/lib/session.js` (Lines 18-35)
*   **Issue**: JWT Access and Refresh tokens are stored in `localStorage` via `writeSession` and `readSession`.
*   **Exploit Scenario**: If the application is vulnerable to Cross-Site Scripting (XSS), an attacker can inject malicious JavaScript to read `localStorage`, exfiltrate the tokens, and impersonate the user.
*   **Impact**: Full account takeover.
*   **Remediation**: Use `httpOnly`, `Secure`, `SameSite` cookies to store tokens. The backend should set these cookies on login/refresh. The frontend should not access them directly.

### 1.2 Weak Token Hashing (High)
*   **File**: `services/auth/src/auth/tokens.js` (Lines 4-6)
*   **Issue**: Refresh tokens are hashed using SHA-256 without a salt: `crypto.createHash("sha256").update(token).digest("hex")`.
*   **Exploit Scenario**: If the database is compromised, an attacker can use rainbow tables or fast brute-force attacks to reverse the hashes (especially if tokens have low entropy, though JWTs usually don't). More importantly, if the attacker also has the JWT signing secret (often in env vars on the same server), they can forge tokens. But even without the secret, if they can reverse the hash, they can use the stolen refresh tokens to get access tokens.
*   **Impact**: Persistence of access for attackers with DB access.
*   **Remediation**: Use a salted hash (like `bcrypt` or `Argon2`) or at least `HMAC-SHA256` with a separate secret key for token storage.

### 1.3 Denial of Service via Large Payload (High)
*   **File**: `services/ingest/src/config.js` and `services/ingest/src/routes/uploadsRoutes.js`
*   **Issue**: `uploadBodyLimitBytes` defaults to 64MB, while `uploadPartSizeBytes` defaults to 5MB. The check for part size happens *after* the request body is fully received and buffered by Fastify (in default configuration).
*   **Exploit Scenario**: An attacker sends many concurrent requests with 60MB bodies. The server buffers them all in memory before rejecting them in the handler, leading to Memory Exhaustion (OOM) and crash.
*   **Impact**: Service unavailability.
*   **Remediation**: Configure `bodyLimit` in Fastify to be slightly larger than `partSize` (e.g., 6MB) or use a streaming multipart parser that enforces limits on the fly.

### 1.4 Path Traversal Risk (Medium)
*   **File**: `services/ingest/src/upload/storage.js` (Lines 37-43)
*   **Issue**: `toSafeExtension` relies on a regex that allows any alphanumeric extension. While mostly safe, it doesn't strictly whitelist safe extensions (like `.jpg`, `.png`).
*   **Exploit Scenario**: An attacker uploads a file named `exploit.php` (if the server was PHP-based or served static files with execution enabled).
*   **Impact**: Potential Remote Code Execution (RCE) if the storage bucket/server is misconfigured to execute scripts.
*   **Remediation**: Whitelist allowed MIME types and extensions strictly.

### 1.5 User Enumeration (Low)
*   **File**: `services/auth/src/routes/authRoutes.js` (Lines 159-161)
*   **Issue**: The registration endpoint explicitly returns `CONFLICT_EMAIL_EXISTS` when an email is already taken.
*   **Exploit Scenario**: An attacker can check if a list of emails (e.g., from a leak) exists on the platform.
*   **Impact**: Privacy violation.
*   **Remediation**: Return a generic "If the email is valid, a registration link has been sent" message, or at least ensure timing attacks don't reveal existence if you change the message. (Note: For a simple app, this might be acceptable, but for high security, it's a risk).

---

## 2. Performance and Scalability

### 2.1 Memory Inefficiency in File Assembly (Critical)
*   **File**: `services/ingest/src/upload/storage.js` (Lines 61-63)
*   **Issue**: `assemblePartsToFile` iterates through parts, reads each entire part into memory using `fs.readFile`, and writes it.
    ```javascript
    const payload = await fs.readFile(partAbsolutePath);
    out.write(payload);
    ```
*   **Impact**: High memory usage. If multiple uploads are finalizing simultaneously, or if parts are large, this will cause GC pressure or OOM.
*   **Remediation**: Use streams. `fs.createReadStream(partPath).pipe(out)` (or `pipeline`).

### 2.2 Memory Inefficiency in Checksum Calculation (Critical)
*   **File**: `services/ingest/src/upload/storage.js` (Lines 74-82)
*   **Issue**: `checksumFileSha256` reads the file using `fsSync.createReadStream` but the implementation is manually handling data events. It is better to use `pipeline` or ensure backpressure is handled, though `createReadStream` handles it well. However, the synchronous `fsSync` usage in an async function is slightly confusing, though it creates a stream. The bigger issue is that for very large files (e.g., 10GB video), calculating checksum on the final file takes a long time and IO.
*   **Impact**: High CPU/IO during upload completion.
*   **Remediation**: Ensure streams are used efficiently.

### 2.3 Blocking Event Loop
*   **File**: `services/ingest/src/upload/storage.js` (Line 76)
*   **Issue**: Uses `fsSync.createReadStream`. While it creates a stream, using `fsSync` methods in a Node.js server (even for stream creation) can be slightly blocking if the filesystem is slow, though `createReadStream` is generally safe.
*   **Remediation**: Use `fs.createReadStream` (from `fs` or `fs/promises` doesn't exist, just `fs`).

---

## 3. Concurrency and Reliability

### 3.1 Race Conditions in File Operations
*   **File**: `services/ingest/src/upload/storage.js`
*   **Issue**: No file locking. If two requests try to finalize the same upload (e.g. retry), they might overwrite or corrupt the file.
*   **Remediation**: Use Idempotency keys (which are implemented! `services/ingest/src/routes/uploadsRoutes.js` uses them). The implementation looks good: `app.repos.idempotency.find` checks if the request was already handled.

### 3.2 Database Transaction Boundaries
*   **File**: `services/ingest/src/routes/uploadsRoutes.js` (Complete Upload)
*   **Issue**: The "Complete Upload" logic performs multiple DB operations (create media, update session, delete temp dir) but not in a single transaction.
*   **Impact**: If `app.repos.media.create` succeeds but `app.repos.uploadSessions.markCompleted` fails, the system is in an inconsistent state (media exists but session is not marked done).
*   **Remediation**: Wrap the completion logic in `db.transaction(...)`.

---

## 4. Framework-Specific Issues

### 4.1 Missing Service Implementations
*   **Services**: `search-service`, `library-service`, `album-sharing-service`, `worker-service`.
*   **Issue**: These services are skeletons with no logic.
*   **Impact**: The application is incomplete.

### 4.2 Fastify Configuration
*   **File**: `services/auth/src/app.js`
*   **Issue**: Missing `trustProxy` configuration if behind Traefik.
*   **Impact**: IP rate limiting (if added) would see the load balancer's IP.
*   **Remediation**: set `trustProxy: true` in Fastify config.

---

## 5. Code Quality and Maintainability

### 5.1 Hardcoded Secrets in Config
*   **File**: `services/auth/src/config.js`
*   **Issue**: default values for secrets (`change-me`) are committed in code.
*   **Impact**: If deployed without env vars, it's insecure.
*   **Remediation**: Throw an error if secrets are missing in production environment (`NODE_ENV === 'production'`).

### 5.2 Duplicate Code
*   **Files**: `services/*/src/app.js`, `services/*/src/config.js`, `services/*/src/db.js`
*   **Issue**: Boilerplate for Fastify app, DB connection, and config loading is repeated across services.
*   **Remediation**: Create a shared library (package) for common infrastructure code.
