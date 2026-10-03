// ponytail: single source of truth for API access rules (formerly the gateway's table)
export function isOpenRoute(method: string, path: string): boolean {
  if (path.startsWith('/docs')) return true
  if (path === '/health') return true
  if (path === '/api/v1/auth' || path.startsWith('/api/v1/auth/')) return true
  if (path === '/api/share' || path.startsWith('/api/share/')) return true
  if (method === 'GET' && /^\/api\/v1\/files\/[^/]+\/stream$/.test(path)) return true
  return false
}

export function isAdminRoute(path: string): boolean {
  return path === '/api/v1/admin' || path.startsWith('/api/v1/admin/')
}

// The only admin routes a worker-minted token (act claim present) may reach — everything
// else under /api/v1/admin/* stays human-admin only. Matches the worker's CoreClient.
const WORKER_ADMIN_ROUTES: [string, RegExp][] = [
  ['DELETE', /^\/api\/v1\/admin\/files\/[^/]+$/],
  ['POST', /^\/api\/v1\/admin\/cleanup-orphans\/run$/],
  ['GET', /^\/api\/v1\/admin\/face-detection$/],
]

export function isWorkerAllowedRoute(method: string, path: string): boolean {
  return WORKER_ADMIN_ROUTES.some(([m, re]) => m === method && re.test(path))
}
