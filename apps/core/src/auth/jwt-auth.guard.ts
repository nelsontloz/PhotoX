import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { loadEnv } from '@photox/shared-config'
import type { JwtPayload, Role } from '@photox/shared-types'
import { isAdminRoute, isOpenRoute, isWorkerAllowedRoute } from './open-routes'

declare global {
  // ponytail: replaces the passport Request.user augmentation removed with passport
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role: Role }
    }
  }
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization
  if (!header) return undefined
  const [scheme, token] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly clockTolerance: number

  constructor(private readonly jwt: JwtService) {
    this.clockTolerance = loadEnv().AUTH_CLOCK_TOLERANCE_SEC
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    const { method, path } = req
    if (isOpenRoute(method, path)) return true

    const token = bearerToken(req)
    if (!token) throw new UnauthorizedException()

    let payload: JwtPayload
    try {
      payload = this.jwt.verify<JwtPayload>(token, {
        algorithms: ['HS256'],
        clockTolerance: this.clockTolerance,
      })
    } catch {
      throw new UnauthorizedException()
    }

    const user = { id: payload.sub, email: payload.email, role: payload.role }
    req.user = user
    if (isAdminRoute(path) && user.role !== 'admin') throw new ForbiddenException('Admin only')
    // worker-actor tokens (act claim, RFC 8693) are locked to an explicit admin allowlist;
    // user routes stay governed by ordinary ownership checks
    if (payload.act && isAdminRoute(path) && !isWorkerAllowedRoute(method, path))
      throw new ForbiddenException('Not allowed for service tokens')
    return true
  }
}
