import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import type { Role } from '@photox/shared-types'

declare global {
  // ponytail: replaces the passport Request.user augmentation removed with passport
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role: Role }
    }
  }
}

// ponytail: open-route table duplicated in apps/gateway/src/auth/open-routes.ts
// (no cross-app runtime imports) — keep in sync
function isOpenRoute(method: string, path: string): boolean {
  if (path.startsWith('/docs')) return true
  if (path === '/health') return true
  if (path === '/api/v1/auth' || path.startsWith('/api/v1/auth/')) return true
  if (path === '/api/share' || path.startsWith('/api/share/')) return true
  if (method === 'GET' && /^\/api\/v1\/files\/[^/]+\/stream$/.test(path)) return true
  return false
}

@Injectable()
export class GatewayIdentityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    if (isOpenRoute(req.method, req.path)) return true

    const id = req.headers['x-user-id']
    const email = req.headers['x-user-email']
    const role = req.headers['x-user-role']
    if (typeof id !== 'string' || !id || typeof email !== 'string' || typeof role !== 'string') {
      throw new UnauthorizedException()
    }
    req.user = { id, email, role: role as Role }
    return true
  }
}
