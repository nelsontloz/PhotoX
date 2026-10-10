import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { randomUUID } from 'crypto'
import type { Request, Response } from 'express'
import { loadEnv } from '@photox/shared-config'
import type { JwtPayload, Role } from '@photox/shared-types'
import { readAccessCookie, setAccessCookie } from './auth-cookie'
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

/** 401s when the request carries no verified user; guarded routes only, never open routes. */
export function requireUserId(ctx: ExecutionContext): string {
  const req = ctx.switchToHttp().getRequest<Request>()
  if (!req.user) throw new UnauthorizedException()
  return req.user.id
}

/** Param decorator injecting the verified JWT user id (`req.user.id`). */
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  requireUserId(ctx),
)

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly clockTolerance: number

  constructor(private readonly jwt: JwtService) {
    this.clockTolerance = loadEnv().AUTH_CLOCK_TOLERANCE_SEC
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>()
    const { method, path } = req
    if (isOpenRoute(path)) return true

    // explicit credentials win: the Authorization header is a deliberate, request-scoped
    // credential — a stale cookie jar (API clients) must not shadow it. Browser subresources
    // carry only the cookie, so it stays the fallback.
    const cookieToken = readAccessCookie(req)
    const token = bearerToken(req) ?? cookieToken
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

    // only the two known roles are accepted; anything else is a forged/foreign token
    if (payload.role !== 'user' && payload.role !== 'admin') throw new UnauthorizedException()

    const user = { id: payload.sub, email: payload.email, role: payload.role }
    req.user = user
    if (isAdminRoute(path) && user.role !== 'admin') throw new ForbiddenException('Admin only')
    // worker-actor tokens (act claim, RFC 8693) are locked to an explicit admin allowlist;
    // user routes stay governed by ordinary ownership checks
    if (payload.act && isAdminRoute(path) && !isWorkerAllowedRoute(method, path))
      throw new ForbiddenException('Not allowed for service tokens')

    // sliding renewal: once past half of its own ttl, a cookie-borne token is re-minted
    // from the verified payload so subresources keep authenticating without client JS
    // ponytail: each parallel request re-mints its own cookie — same exp, no coordination
    if (
      cookieToken !== undefined &&
      typeof payload.exp === 'number' &&
      typeof payload.iat === 'number'
    ) {
      const now = Date.now() / 1000
      const ttl = payload.exp - payload.iat
      if (payload.exp - now < ttl / 2) {
        const renewed = await this.jwt.signAsync({
          sub: payload.sub,
          email: payload.email,
          role: payload.role,
          jti: randomUUID(),
          // a worker-actor token must stay locked to the admin allowlist after renewal
          ...(payload.act ? { act: payload.act } : {}),
        })
        setAccessCookie(context.switchToHttp().getResponse<Response>(), renewed, ttl * 1000)
      }
    }
    return true
  }
}
