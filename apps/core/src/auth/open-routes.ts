// ponytail: single source of truth for API access rules (formerly the gateway's table)
export function isOpenRoute(path: string): boolean {
  if (path.startsWith('/docs')) return true
  if (path === '/health') return true
  if (path === '/api/v1/auth' || path.startsWith('/api/v1/auth/')) return true
  if (path === '/api/share' || path.startsWith('/api/share/')) return true
  // file streams are not capability URLs — same-origin browser subresources authenticate
  // via the HttpOnly access cookie (or Bearer for API clients)
  return false
}

export function isAdminRoute(path: string): boolean {
  return path === '/api/v1/admin' || path.startsWith('/api/v1/admin/')
}

// The only admin route a worker-minted token (act claim present) may reach — everything
// else under /api/v1/admin/* stays human-admin only.
const WORKER_ADMIN_ROUTES: [string, RegExp][] = [['GET', /^\/api\/v1\/admin\/face-detection$/]]

export function isWorkerAllowedRoute(method: string, path: string): boolean {
  if (isWorkerRoute(path)) return true
  return WORKER_ADMIN_ROUTES.some(([m, re]) => m === method && re.test(path))
}

// Worker job surface: act-required, owner-scoped by the job's sub through the reused services.
// Single-resource user GET /assets/:id, user PATCH :id/metadata and stream/download stay out.
export function isWorkerRoute(path: string): boolean {
  return path === '/worker' || path.startsWith('/worker/')
}
