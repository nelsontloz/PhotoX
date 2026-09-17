// ponytail: open-route table duplicated in apps/core/src/auth/gateway-identity.guard.ts
// (no cross-app runtime imports) — keep in sync
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
