# Comprehensive Code Audit Report

**Date:** 2026-02-18
**Auditor:** Jules (Senior Software Engineer)

## Executive Summary

A comprehensive audit of the PhotoX codebase (Services & Web App) was conducted to identify security vulnerabilities, performance bottlenecks, and code quality issues. Several critical security and performance issues were identified and remediated. Some issues remain due to architectural constraints or the need for significant API contract changes.

## 1. Security Analysis

### 1.1. Weak Password Policy (Fixed)
*   **Finding:** The password validation logic in `services/auth/src/auth/password.js` only checked for a minimum length of 8 characters.
*   **Impact:** Users could set weak passwords, making accounts vulnerable to brute-force attacks.
*   **Remediation:** Updated `validatePassword` to enforce a strong policy: 12-128 characters, at least one uppercase letter, one lowercase letter, one number, and one special character. Unit tests were updated to verify this policy.

### 1.2. Missing Security Headers (Fixed)
*   **Finding:** Backend services (`auth`, `ingest`, `library`) did not set standard security headers (HSTS, X-Frame-Options, X-Content-Type-Options, CSP).
*   **Impact:** increased risk of Man-in-the-Middle (MitM), Clickjacking, and MIME sniffing attacks.
*   **Remediation:** Added a global `onRequest` hook to `app.js` in all three services to set these headers.

### 1.3. User Enumeration (Flagged)
*   **Finding:** The `POST /api/v1/auth/register` endpoint returns `409 Conflict` with the message "Email is already registered" when an email exists.
*   **Impact:** Attackers can enumerate registered email addresses.
*   **Status:** **Flagged**. Fixing this requires changing the API contract (e.g., returning `200 OK` with a generic message), which would break the current frontend implementation. Recommended for a future breaking-change release.

### 1.4. Stored XSS Risk (Flagged)
*   **Finding:** The frontend (`apps/web/lib/session.js`) stores JWT access and refresh tokens in `localStorage`.
*   **Impact:** If an attacker achieves Cross-Site Scripting (XSS) on the domain, they can steal these tokens and hijack user sessions.
*   **Status:** **Flagged**. Remediation requires moving to `HttpOnly` cookies, which involves significant changes to the auth flow and backend cookie handling.

### 1.5. Insecure Hashing Configuration (Flagged)
*   **Finding:** `verifyPassword` in `services/auth/src/auth/password.js` strictly enforces the `$argon2` prefix, preventing support for legacy hashes (e.g., bcrypt) if migration is needed.
*   **Impact:** Limits flexibility for importing users from other systems.
*   **Status:** **Flagged**. Low priority as this is a new system, but should be addressed if migration support is required.

## 2. Performance and Scalability

### 2.1. Inefficient File Processing (Fixed)
*   **Finding:** The `ingest-service` read assembled files twice: once to write them to disk and once to compute the SHA-256 checksum.
*   **Impact:** doubled I/O and increased CPU usage for large file uploads.
*   **Remediation:** Modified `assemblePartsToFile` in `services/ingest/src/upload/storage.js` to compute the checksum using a stream transformer *during* the write process. Updated `uploadsRoutes.js` to use the returned checksum.

### 2.2. Inefficient Database Query (Fixed)
*   **Finding:** The `listTimeline` query in `services/library/src/repos/libraryRepo.js` used `COALESCE(mf.deleted_soft, false) = false` in the `WHERE` clause.
*   **Impact:** `COALESCE` prevents the database from effectively using an index on the `deleted_soft` column, potentially leading to full table scans.
*   **Remediation:** Changed the condition to `(mf.deleted_soft IS NULL OR mf.deleted_soft = false)`, which is semantically equivalent but allows index usage.

### 2.3. Inefficient Full-Text Search (Flagged)
*   **Finding:** Search functionality uses `ILIKE '%query%'` (leading wildcard).
*   **Impact:** This forces a full table scan on every search, which will not scale with library size.
*   **Status:** **Flagged**. Remediation requires implementing Full-Text Search (PostgreSQL `tsvector`/`tsquery`) or using a dedicated search engine.

## 3. Concurrency and Reliability

*   **Findings:**
    *   **Ingest:** Proper `FOR UPDATE` locking is used during upload completion to prevent race conditions.
    *   **Auth:** Registration uses `pg_advisory_xact_lock` (or handles unique constraint violations) correctly to prevent duplicate user creation.
    *   **Status:** No critical concurrency issues found.

## 4. Code Quality

*   **Duplication:** Authentication middleware (`requireAccessAuth`) is duplicated across services. Recommended to extract to a shared internal package in the future.
*   **Hardcoded Values:** Some configuration values (like specific file paths) rely on convention. `services/ingest/src/upload/storage.js` uses hardcoded `_tmp`.

## 5. Framework-Specific Issues

*   **Fastify:** Security headers were missing (Fixed).
*   **Next.js:** `next.config.js` is missing, relying on defaults. Recommended to add security headers there as well.

## 6. Open Pull Requests
*   PRs related to performance optimizations (`perf/ingest-uploads...`) and security fixes (`fix-bcrypt...`) were noted. This audit's findings align with or extend those efforts. The fixes applied here (checksum streaming, library query opt) likely supersede or complement pending PRs.

## Summary of Applied Fixes
1.  **Auth:** Strong password policy enforced.
2.  **Auth/Ingest/Library:** Security headers added.
3.  **Ingest:** Streaming checksum calculation implemented.
4.  **Library:** Timeline query optimized for indexing.
