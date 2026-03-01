# Comprehensive Senior-Level Code Audit Report

## Introduction
This report documents the findings from a comprehensive senior-level code audit of the PhotoX repository. The audit evaluates Security, Performance & Scalability, Concurrency & Reliability, Framework-Specific Issues, and Code Quality. It cross-references current implementations with open pull requests (such as `origin/perf/timeline-prefetch-neighbor-index`) to prevent duplicate findings where items are already mitigated.

---

## 1. Security Analysis

### 1.1 Insecure Token Storage (Critical)
* **File:** `apps/web/lib/session.js`
* **Risk:** The frontend stores authentication tokens (access and refresh) in browser `localStorage`. This makes them fully accessible to JavaScript, leading to an extremely high risk of token exfiltration in the event of a Cross-Site Scripting (XSS) vulnerability.
* **Exploit Scenario:** An attacker injects malicious JavaScript into the application. The script reads `localStorage` and transmits the tokens to an attacker-controlled server, leading to full account takeover.
* **Remediation:** Migrate away from `localStorage` to `httpOnly`, `Secure`, `SameSite=Strict` cookies. The server should set the cookies using the `Set-Cookie` header, and CSRF protection (e.g., anti-CSRF tokens) must be implemented.
  *Code fix:* Move token management to server-side components or dedicated API routes using `res.setHeader('Set-Cookie', ...)` and configure them as non-accessible to client scripts.

### 1.2 User Enumeration on Registration (Low/Medium)
* **File:** `services/auth/src/routes/authRoutes.js`, Line: 204 & 215
* **Risk:** The API returns `409 Conflict` explicitly when an email is already registered (`CONFLICT_EMAIL_EXISTS`). This permits attackers to script enumeration attacks to build lists of valid user emails.
* **Exploit Scenario:** An attacker repeatedly POSTs to `/api/v1/auth/register` using a wordlist of emails to identify targets that hold an account on this system.
* **Remediation:** Do not leak whether an account exists. The API should return `200 OK` or `201 Created` with a generic success message, and trigger an asynchronous email notification (e.g., "If an account doesn't exist, we've created one and sent a confirmation email"). Due to current API design returning `user` on `201`, returning a dummy user object or restructuring the frontend registration flow to expect a generic message is recommended.

### 1.3 JWT Default Algorithm Negotiation (Medium)
* **File:** `services/auth/src/auth/tokens.js`, Lines: 25, 39
* **Risk:** The implementation uses `jwt.sign` without explicitly specifying an `algorithm` in the options block. While `jsonwebtoken` defaults to `HS256`, relying on implicit defaults exposes the service to potential algorithm confusion attacks if an RSA/ECDSA key is later used, or if library defaults change.
* **Exploit Scenario:** A future developer switches to asymmetric keys without enforcing algorithms during `jwt.verify()`, opening up an attack where a symmetric signature verified with an asymmetric public key leads to forged tokens.
* **Remediation:**
  ```javascript
  // Fix in createAccessToken and createRefreshToken
  return jwt.sign(
    { type: "access", email: user.email },
    secret,
    { subject: user.id, expiresIn: expiresInSeconds, algorithm: 'HS256' } // Explicit algorithm
  );
  ```
  *(Also enforce `algorithms: ['HS256']` in `jwt.verify` calls).*

---

## 2. Performance and Scalability

### 2.1 Missing Rate Limiting on Authentication Routes (High)
* **File:** `services/auth/src/routes/authRoutes.js`
* **Risk:** The login and registration endpoints execute expensive operations (`argon2.hash` and `argon2.verify` with high-cost parameters). The lack of rate-limiting enables trivial Resource Exhaustion / Denial of Service (DoS) attacks.
* **Exploit Scenario:** A malicious botnet blasts the `/api/v1/auth/login` endpoint with rapid requests. The CPUs handling the Fastify node are entirely consumed computing Argon2 hashes, starving out legitimate user requests.
* **Remediation:** Implement a standard rate-limiter, such as `@fastify/rate-limit`, limiting IPs to a low number of attempts (e.g., 5 attempts per 15 minutes) for auth routes.

### 2.2 Unoptimized `ILIKE` Full-Text Search
* **Location:** Identified via architectural context / repository memory in `library-service`.
* **Risk:** Full-text search queries execute using `ILIKE '%query%'` with a leading wildcard, completely invalidating index lookups and enforcing full table scans on large media tables.
* **Remediation:** Adopt the `pgvector` hybrid search architecture planned for `search-service` or, as an intermediate step, implement PostgreSQL full-text search (`to_tsvector` and `GIST`/`GIN` indexes).

*(Note: The `library-service` timeline query was previously flagged for O(N) neighbor lookup issues, but this is actively mitigated by the `origin/perf/timeline-prefetch-neighbor-index` branch).*

---

## 3. Concurrency and Reliability

### 3.1 Unbounded Promise Execution
* **Location:** Generic pattern found in Node.js Fastify services where `Promise.all` is used extensively without concurrency limits.
* **Risk:** Resolving large arrays of files or DB rows through `Promise.all` can overwhelm Node.js memory limits or exhaust PostgreSQL connection pools.
* **Remediation:** Use bounded concurrency utilities such as `p-map` or bluebird's `Promise.map({ concurrency: 10 })` to ensure the system gracefully processes large lists.

---

## 4. Framework-Specific Issues

### 4.1 Missing Fastify `trustProxy` Configuration
* **File:** `services/auth/src/app.js` (and other microservice `app.js` files)
* **Risk:** Fastify instances operate behind Traefik (Docker Compose Gateway) but do not explicitly configure `trustProxy: true`. As a result, `request.ip` resolves to the Traefik internal Docker IP instead of the actual client IP.
* **Exploit Scenario:** If rate limiting or audit logging uses `request.ip`, it will rate-limit the gateway itself, effectively causing a DoS for all users if a single attacker triggers the limit.
* **Remediation:**
  ```javascript
  const app = Fastify({
    logger: true,
    trustProxy: true, // Required for reverse-proxy setups
    // ...
  });
  ```

---

## 5. Code Quality and Maintainability

### 5.1 Hardcoded Config Defaults (Security Tech Debt P100-S2)
* **File:** `services/auth/src/config.js` and equivalent service config files.
* **Risk:** The codebase contains fallback dummy secret keys if `NODE_ENV !== 'production'`. While nominally safe if production is perfectly configured, it introduces a massive risk if a production container accidentally launches without the environment variable set.
* **Remediation:** Implement a strict fail-fast startup check that refuses to boot if cryptographic secrets are absent or weak, regardless of environment flags.

### 5.2 Broad and Duplicated Authentication Guards
* **Location:** `requireAccessAuth` implementations spread across services (`services/library/src/auth/guard.js`, `services/auth/...`, `services/ingest/...`).
* **Risk:** The token verification logic is duplicated instead of centralized into a shared NPM library/package. This increases the burden of maintenance (e.g., migrating to symmetric/asymmetric signatures requires updates in 4+ separate codebases).
* **Remediation:** Extract all JWT verification, Fastify preHandler decorators, and error mappings into a `packages/shared-auth` monorepo library.

---

## 6. Pull Request Awareness

* **PR Context Checked:** `origin/perf/timeline-prefetch-neighbor-index`
* **Finding Withheld:** O(N) redundant timeline prefetch lookup in `library-service` and missing `deleted_soft_at` flags logic were originally candidates for this report. However, `origin/perf/timeline-prefetch-neighbor-index` (and related recent fixes) explicitly resolve the `deleted_soft_at` assignment and the frontend timeline prefetch query redundancy. Thus, they have been successfully excluded from the active issues list.
