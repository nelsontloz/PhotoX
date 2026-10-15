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

// act-carrying worker tokens are default-denied everywhere except the worker job surface;
// no admin route is worker-reachable (the face-detection read was retired with the old
// detector-setting contract).
export function isWorkerAllowedRoute(path: string): boolean {
  return isWorkerRoute(path)
}

// Worker job surface: act-required, owner-scoped by the job's sub through the reused services.
// Single-resource user GET /assets/:id, user PATCH :id/metadata and stream/download stay out.
export function isWorkerRoute(path: string): boolean {
  return path === '/worker' || path.startsWith('/worker/')
}
