import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService, type JwtVerifyOptions } from '@nestjs/jwt'
import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import type { Request, Response } from 'express'
import { DataSource } from 'typeorm'
import { loadAuthEnv, loadEnv } from '@photox/shared-config'
import type { JwtPayload, Role } from '@photox/shared-types'
import { readAccessCookie, isSecureRequest, setAccessCookie } from './auth-cookie'
import { isActListRoute, isAdminRoute, isOpenRoute, isWorkerRoute } from './open-routes'
import { User } from '../users/entities/user.entity'

declare global {
  // ponytail: replaces the passport Request.user augmentation removed with passport
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role: Role }
    }
  }
}

// the verified claim set is untrusted input: JwtPayload describes what WE mint, not what a
// token may carry — a validly signed token without a subject is a JWT with no identity
interface VerifiedPayload extends Omit<JwtPayload, 'sub'> {
  sub?: unknown
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
  // defense in depth: an empty id must never reach the ownership filters — TypeORM drops
  // undefined where values, so a missing userId predicate matches ANY row (audit #1/#2)
  const user = req.user
  if (!user?.id) throw new UnauthorizedException()
  return user.id
}

/** Param decorator injecting the verified JWT user id (`req.user.id`). */
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  requireUserId(ctx),
)

// worker ranking fetches page the user list endpoint by ids; the guard scopes rows by sub.
// The exception is pinned to that ONE list route (open-routes.isActListRoute): keying it on
// the query shape alone ("the request carries an ids query") made every `?ids=` route
// service-token reachable — including the byte-serving file stream, with no job binding
// attached (API security audit, finding #3).
function isActListRead(req: Request, path: string): boolean {
  if (!isActListRoute(path)) return false
  // the router matches the method case-insensitively (Express lowercases it), so the
  // policy must not be stricter than the router here; an absent method fails closed
  if (req.method?.toUpperCase() !== 'GET') return false
  const ids = (req.query as { ids?: unknown } | undefined)?.ids
  return typeof ids === 'string' ? ids.length > 0 : Array.isArray(ids) && ids.length > 0
}

// candidate scopes for the HMAC binding, in request-priority order: the route target
// (path id/fileId), then the register-file body asset, then the worker's claimed scope,
// else the sub itself (persons routes, whose cluster jobs are user-scoped). The enqueue
// stamps scope from the JOB payload (first of assetId|fileId|userId — usually the asset)
// while file reads address the fileId, so no single derived scope fits every legit call;
// the guard accepts when the presented sig verifies against ANY non-empty candidate.
// Unforgeability holds (only the secret holder mints sigs) and sub-scoped services still
// enforce ownership, so an assetId-scoped sig reading that asset's file adds no capability.
function jobScopesFrom(req: Request, sub: string): string[] {
  const scopes: string[] = []
  const params = req.params as Record<string, unknown> | undefined
  const body = req.body as Record<string, unknown> | undefined
  const header = req.headers['x-job-scope']
  for (const v of [params?.id, params?.fileId, body?.assetId, header, sub]) {
    if (typeof v === 'string' && v.length > 0 && !scopes.includes(v)) scopes.push(v)
  }
  return scopes
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly clockTolerance: number
  private readonly userSecret: string
  private readonly previousSecret?: string
  private readonly workerSecret: string

  constructor(
    private readonly jwt: JwtService,
    @Optional() private readonly dataSource?: DataSource,
  ) {
    this.clockTolerance = loadEnv().AUTH_CLOCK_TOLERANCE_SEC
    const auth = loadAuthEnv()
    this.userSecret = auth.AUTH_TOKEN_SECRET
    this.previousSecret = auth.AUTH_TOKEN_SECRET_PREVIOUS
    this.workerSecret = auth.WORKER_JWT_SECRET
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>()
    const { path } = req
    if (isOpenRoute(path)) return true

    // explicit credentials win: the Authorization header is a deliberate, request-scoped
    // credential — a stale cookie jar (API clients) must not shadow it. Browser subresources
    // carry only the cookie, so it stays the fallback.
    const cookieToken = readAccessCookie(req)
    const token = bearerToken(req) ?? cookieToken
    if (!token) throw new UnauthorizedException()

    // rotation + worker split as a guard-level fallback (no extra JwtModule): the user
    // secret first, then the previous secret during rotation, then the worker secret —
    // a worker-secret hit is marked worker-origin below (act still gates the allowlist)
    const verifyOpts: JwtVerifyOptions = {
      algorithms: ['HS256'],
      clockTolerance: this.clockTolerance,
    }
    const candidates: { secret: string; worker: boolean }[] = [
      { secret: this.userSecret, worker: false },
      ...(this.previousSecret ? [{ secret: this.previousSecret, worker: false }] : []),
      { secret: this.workerSecret, worker: true },
    ]
    let payload: VerifiedPayload | undefined
    let workerOrigin = false
    for (const { secret, worker } of candidates) {
      try {
        payload = this.jwt.verify<VerifiedPayload>(token, { ...verifyOpts, secret })
        workerOrigin = worker
        break
      } catch {
        continue
      }
    }
    if (!payload) {
      throw new UnauthorizedException()
    }
    // a token without a subject is not an identity: TypeORM drops undefined where values, so
    // `findOne({ where: { id: undefined } })` matches an ARBITRARY user row and the ownership
    // filter (findOne({ where: { id, userId: undefined } })) loses its tenant predicate — a
    // subject-less token reads another user's asset (API security audit, findings #1/#2).
    // The worker-actor pseudo-sub ('worker-service') is a non-empty string and stays legal:
    // its users-row lookup fails closed (invalid uuid -> no row -> act tokens pass).
    const sub = payload.sub
    if (typeof sub !== 'string' || sub.length === 0) throw new UnauthorizedException()
    // a worker-secret token without act borrows no identity: even with a real sub it never
    // reaches the floor check (every legit CoreClient token carries act, so nothing breaks)
    if (workerOrigin && !payload.act) throw new UnauthorizedException()

    // only the two known roles are accepted; anything else is a forged/foreign token
    if (payload.role !== 'user' && payload.role !== 'admin') throw new UnauthorizedException()

    // session floor: logout/reuse bumps users.tokensValidAfter, killing access tokens minted
    // before it. Runs for Bearer and cookie alike, before the sliding re-mint below.
    // ponytail: per-request O(1) PK lookup — Redis-cache the floor if this shows up hot
    if (this.dataSource) {
      if (typeof payload.iat !== 'number') throw new UnauthorizedException()
      // a failed lookup reads as "no row": non-act tokens still fail closed below, while
      // worker-actor pseudo-subs (e.g. worker-service, not a uuid Postgres can cast) pass
      let row: { tokensValidAfter: Date | null } | null
      try {
        row = await this.dataSource
          .getRepository(User)
          .findOne({ where: { id: sub }, select: ['id', 'tokensValidAfter'] })
      } catch {
        row = null
      }
      // no user row fails closed — except worker-actor pseudo-subs (e.g. worker-service),
      // which have no users row; user-sub worker tokens still hit the floor above
      if (!row && !payload.act) throw new UnauthorizedException()
      // second granularity: iat is seconds while the floor carries ms
      if (row?.tokensValidAfter && Math.floor(row.tokensValidAfter.getTime() / 1000) > payload.iat)
        throw new UnauthorizedException()
    }

    const user = { id: sub, email: payload.email, role: payload.role }
    req.user = user
    if (isAdminRoute(path) && user.role !== 'admin') throw new ForbiddenException('Admin only')
    // the worker namespace is act-only: a plain user token proves no job delegation
    if (isWorkerRoute(path) && !payload.act) throw new ForbiddenException('Worker only')
    // worker-actor tokens (act claim, RFC 8693) may reach only the worker job surface —
    // no admin route is worker-reachable; the user list-by-ids read stays act-usable for
    // worker ranking fetches
    if (payload.act && !isWorkerRoute(path) && !isActListRead(req, path))
      throw new ForbiddenException('Not allowed for service tokens')
    // ponytail: HMAC job binding — a worker-origin token alone proves only delegation, not that
    // a job was enqueued for this target; every /worker/* call (reads included — a forged
    // act token otherwise reads any victim row) must carry the X-Job-Signature the enqueue
    // stamped (HMAC of sub:scope under WORKER_JWT_SECRET). Scoped to worker-origin
    // because only the worker mints act tokens in prod (auth never sets act; the user-secret act
    // tokens in specs are pre-binding stand-ins). Ceiling: scope is the asset,
    // not the job — a leaked token replays within its asset until it expires.
    if (workerOrigin && payload.act && isWorkerRoute(path)) this.assertJobBinding(req, sub)

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
        const renewed = await this.jwt.signAsync(
          {
            sub,
            email: payload.email,
            role: payload.role,
            jti: randomUUID(),
            // a worker-actor token must stay locked to the admin allowlist after renewal
            ...(payload.act ? { act: payload.act } : {}),
          },
          { keyid: 'cur' },
        )
        setAccessCookie(
          context.switchToHttp().getResponse<Response>(),
          renewed,
          ttl * 1000,
          isSecureRequest(req),
        )
      }
    }
    return true
  }

  private assertJobBinding(req: Request, sub: string): void {
    const presented = req.headers['x-job-signature']
    const valid =
      typeof presented === 'string' &&
      jobScopesFrom(req, sub).some((scope) => {
        const expectedHex = createHmac('sha256', this.workerSecret)
          .update(`${sub}:${scope}`)
          .digest('hex')
        // length-checked first: timingSafeEqual throws on mismatched lengths
        return (
          presented.length === expectedHex.length &&
          timingSafeEqual(Buffer.from(presented), Buffer.from(expectedHex))
        )
      })
    if (!valid) throw new ForbiddenException('Missing or invalid job binding')
  }
}
