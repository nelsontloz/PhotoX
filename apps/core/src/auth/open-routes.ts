// ponytail: single source of truth for API access rules (formerly the gateway's table)
//
// The rules below are matched with a case-insensitive RegExp — the SAME mechanism the
// router uses to match routes (path-to-regexp 8: `new RegExp(pattern, 'i')`, no `u` flag).
// The policy and the router therefore agree on every path by construction.
//
// A case-sensitive prefix comparison let the casing of the URL decide the policy: the
// router resolved `/API/V1/ADMIN/USERS` to the admin controller while `isAdminRoute`
// said false, so the admin role check was skipped and a plain user reached the admin
// surface (user list, account rewrite, account delete, library-wide maintenance). The
// same gap reached the worker surface, skipping the act + X-Job-Signature job binding.
// API security audit, findings #1-#3.
//
// ponytail: a plain `toLowerCase()` fold would be almost as good but not the same
// function the router uses — the engine's `i` flag folds ASCII only, and the two
// disagree on exotic code points (U+212A KELVIN SIGN, U+0131, U+017F). Mirroring the
// router's own matcher keeps the invariant checkable instead of argued.

/** `/api/v1/admin` itself or anything under it. */
const ADMIN_ROUTE = /^\/api\/v1\/admin(?:\/|$)/i

/** The worker job surface: `/worker` itself or anything under it. */
const WORKER_ROUTE = /^\/worker(?:\/|$)/i

const AUTH_ROUTE = /^\/api\/v1\/auth(?:\/|$)/i
const SHARE_ROUTE = /^\/api\/share(?:\/|$)/i
/** Swagger UI and its JSON asset. */
const DOCS_ROUTE = /^\/docs/i
const HEALTH_ROUTE = /^\/health$/i

export function isOpenRoute(path: string): boolean {
  if (DOCS_ROUTE.test(path)) return true
  if (HEALTH_ROUTE.test(path)) return true
  if (AUTH_ROUTE.test(path)) return true
  if (SHARE_ROUTE.test(path)) return true
  // file streams are not capability URLs — same-origin browser subresources authenticate
  // via the HttpOnly access cookie (or Bearer for API clients)
  return false
}

export function isAdminRoute(path: string): boolean {
  return ADMIN_ROUTE.test(path)
}

// Worker job surface: act-required, owner-scoped by the job's sub through the reused services.
// Single-resource user GET /assets/:id, user PATCH :id/metadata and stream/download stay out.
export function isWorkerRoute(path: string): boolean {
  return WORKER_ROUTE.test(path)
}
