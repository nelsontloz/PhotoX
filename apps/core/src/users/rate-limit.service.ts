import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { BullMqService } from '../queue/bullmq.service'

type RateLimitRoute = 'login' | 'loginIp' | 'register' | 'refresh'

// ponytail: fixed windows as a module constant — tune here; per-user/admin config if ever needed
export const RATE_LIMITS: Record<RateLimitRoute, { limit: number; windowSec: number }> = {
  login: { limit: 5, windowSec: 900 },
  // coarser per-IP bucket so email rotation can't multiply the per-email allowance
  loginIp: { limit: 20, windowSec: 900 },
  register: { limit: 10, windowSec: 3600 },
  refresh: { limit: 30, windowSec: 900 },
}

// atomic fixed window: INCR plus EXPIRE only when the window is created, so a crash can never
// leave a no-TTL key that permanently locks out the bucket
const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`

// ponytail: 300ms budget — Redis down/slow must not hang auth; see fail-open in consume()
export const RATE_LIMIT_TIMEOUT_MS = 300

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name)

  constructor(private readonly bullMq: BullMqService) {}

  /**
   * Fixed-window counter: first hit sets the window TTL, throws 429 once the limit is exceeded.
   * Fails open (allows the request) when Redis is unavailable, not yet connected, or too slow.
   */
  async consume(route: RateLimitRoute, ip: string, email?: string): Promise<void> {
    const { limit, windowSec } = RATE_LIMITS[route]
    // encode segments so ':' in IPv6 addresses/emails can't alias another bucket;
    // lowercase only the key — the email lookup elsewhere stays case-sensitive
    const key = `rl:${route}:${encodeURIComponent(ip)}:${encodeURIComponent(email?.toLowerCase() ?? '-')}`

    const count = await this.countHit(key, windowSec)
    if (count === null) {
      // ponytail: fail-open — argon2 still gates login and a personal instance prefers
      // availability; fail-closed would need a dedicated short-retry Redis client
      this.logger.warn(`Rate limit unavailable for ${route} (${key}); allowing request`)
      return
    }

    if (count > limit) {
      this.logger.warn(`Rate limit exceeded: ${route} ${ip} ${email?.toLowerCase() ?? '-'}`)
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  /** null = Redis unavailable/timed out (caller fails open); otherwise the new window count. */
  private async countHit(key: string, windowSec: number): Promise<number | null> {
    let timer: NodeJS.Timeout | undefined
    try {
      const redis: Redis | undefined = this.bullMq.redis
      if (!redis) return null // undefined until BullMqService.onModuleInit
      return await Promise.race([
        redis.eval(RATE_LIMIT_SCRIPT, 1, key, windowSec) as Promise<number>,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), RATE_LIMIT_TIMEOUT_MS)
        }),
      ])
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}
