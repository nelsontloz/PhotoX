# Comprehensive Code Audit Report: PhotoX

**Date:** 2026-02-18
**Auditor:** Senior Software Engineer (Jules)

This report details the findings of a comprehensive code audit of the PhotoX repository, covering security, performance, reliability, and code quality.

---

## 1. Security Analysis

### 1.1 User Enumeration (High)
*   **File:** `services/auth/src/routes/authRoutes.js`
*   **Location:** `app.post("/api/v1/auth/register", ...)`
*   **Finding:** The registration endpoint explicitly returns a `409 CONFLICT` with the message "Email is already registered" when a user attempts to register with an existing email address. This allows an attacker to enumerate valid email addresses in the system.
*   **Exploit Scenario:** An attacker can script requests with a list of email addresses. If the server returns 409, the email is valid. If it returns 201, it's new. This can be used for targeted phishing or credential stuffing.
*   **Remediation:** Always return a generic success message (201 Created) even if the user exists, or send an email notification instead of an immediate error. If immediate feedback is required for UX, use a generic error message or CAPTCHA to rate-limit enumeration.

    **Corrected Code:**
    ```javascript
    // services/auth/src/routes/authRoutes.js

    // ... inside register handler
    const existingUser = await app.repos.users.findByEmail(email);
    if (existingUser) {
      // SILENT FAIL: Return success to prevent enumeration, or send email.
      // Ideally, trigger an email saying "Someone tried to register with your email."
      // For this API, returning 201 with the existing user (sanitized) or a dummy user is safer.
      // However, strictly:
      request.log.info({ email }, "Registration attempt for existing email");
      return reply.code(201).send({ user: app.repos.users.toPublicUser(existingUser) });
      // OR better: return nothing and send email.
    }
    ```

### 1.2 Stored XSS via LocalStorage (Critical)
*   **File:** `apps/web/lib/session.js`
*   **Location:** `writeSession` function
*   **Finding:** JWTs (Access and Refresh tokens) are stored in `localStorage`. This makes them accessible to any JavaScript running on the page, including malicious scripts injected via XSS vulnerabilities (e.g., in a dependency or a compromised CDN).
*   **Exploit Scenario:** An attacker injects a script (e.g., via a vulnerability in a third-party library or a reflected XSS in another part of the app). The script reads `localStorage.getItem("photox.session.v1")` and sends the tokens to the attacker's server, allowing full account takeover.
*   **Remediation:** Store tokens in `httpOnly` cookies, which are inaccessible to JavaScript.

    **Corrected Code:**
    Refactor `auth-service` to set cookies on login/refresh, and `apps/web` to rely on cookies.
    (This requires architectural changes to `auth-service` responses).

### 1.3 Missing Security Headers (Medium)
*   **Files:**
    *   `services/auth/src/app.js`
    *   `services/ingest/src/app.js`
    *   `services/library/src/app.js`
    *   `apps/web/next.config.js` (Missing)
*   **Finding:** Backend services (Fastify) do not use `fastify-helmet` to set standard security headers (HSTS, X-Frame-Options, X-Content-Type-Options). The Frontend (Next.js) also lacks these headers.
*   **Impact:** Increases risk of Clickjacking, MIME-sniffing attacks, and man-in-the-middle attacks (due to missing HSTS).
*   **Remediation:**
    *   **Backend:** Install `@fastify/helmet` and register it in `app.js`.
    *   **Frontend:** Configure `headers()` in `next.config.js`.

    **Corrected Code (Backend):**
    ```javascript
    // services/auth/src/app.js
    const helmet = require("@fastify/helmet");
    // ...
    app.register(helmet, { global: true });
    ```

### 1.4 Insecure Docker Service Exposure (Medium)
*   **File:** `docker-compose.yml`
*   **Location:** `postgres` (ports), `redis` (ports), `prometheus` (ports), `grafana` (ports)
*   **Finding:** Services are exposed using `"${PORT}:PORT"` syntax. If `PORT` is just a number (e.g., `5432`), Docker binds it to `0.0.0.0`, exposing the database to the entire network (and potentially the internet if the host is public).
*   **Impact:** Unintended external access to sensitive data stores.
*   **Remediation:** Explicitly bind to `127.0.0.1` for local development or use a firewall.

    **Corrected Code:**
    ```yaml
    postgres:
      ports:
        - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    redis:
      ports:
        - "127.0.0.1:${REDIS_PORT:-6379}:6379"
    ```

---

## 2. Performance and Scalability

### 2.1 Missing `trustProxy` Configuration (Medium)
*   **Files:** `services/*/src/app.js`
*   **Finding:** Fastify services are behind Traefik (a reverse proxy) but `trustProxy` is not configured.
*   **Impact:** `request.ip` will likely be the internal IP of the Traefik container, not the real client IP. This breaks IP-based rate limiting, logging, and audit trails.
*   **Remediation:** Enable `trustProxy`.

    **Corrected Code:**
    ```javascript
    const app = Fastify({
      logger: true,
      trustProxy: true // Enable this
      // ...
    });
    ```

---

## 3. Concurrency and Reliability

### 3.1 Legacy Password Hash Regression (High)
*   **File:** `services/auth/src/auth/password.js`
*   **Location:** `verifyPassword` function
*   **Finding:** The function strictly checks `if (!passwordHash.startsWith("$argon2")) return false;`. This prevents the system from verifying legacy hashes (e.g., bcrypt) if the system was migrated or if older hashes exist.
*   **Impact:** Users with valid legacy passwords will be unable to log in, causing a service outage for them.
*   **Remediation:** Allow other hash prefixes if supported, or remove the check if `argon2.verify` handles format detection (though explicit checks are safer, they must include all supported formats).

    **Corrected Code:**
    ```javascript
    async function verifyPassword(password, passwordHash) {
      // Remove or expand strict check to support migration scenarios
      // if (typeof passwordHash !== "string" || !passwordHash.startsWith("$argon2")) { ... }

      try {
        return await argon2.verify(passwordHash, password);
      } catch {
        return false;
      }
    }
    ```

---

## 4. Code Quality and Maintainability

### 4.1 Hardcoded Secrets in Configuration (Low)
*   **Files:** `services/*/src/config.js`
*   **Finding:** Default values for secrets (e.g., `photox-dev-password`) are present in the code. While `resolveRequiredSecret` enforces stronger values in production, having these defaults can lead to accidental usage in non-production environments that are exposed.
*   **Remediation:** Remove defaults for secrets entirely and rely on `.env` files or environment variables, forcing the developer to set them explicitly.

---

## 5. Framework-Specific Issues

### 5.1 ML Service Scaffold
*   **File:** `services/ml/app.py`
*   **Finding:** The ML service is currently a placeholder. It uses FastAPI but implements no logic.
*   **Recommendation:** Ensure `pydantic` models are used for input validation once logic is added, and avoid `pickle` for model loading if possible (use `safetensors` or `onnx`).

### 5.2 Next.js Security Configuration
*   **File:** `apps/web/next.config.js` (Missing)
*   **Finding:** Absence of `next.config.js` means default headers are used.
*   **Recommendation:** Create the file and add `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`.
