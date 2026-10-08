import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { BullMqService } from '../queue/bullmq.service'

export type RateLimitRoute = 'login' | 'register' | 'refresh'

// ponytail: fixed windows as a module constant — tune here; per-user/admin config if ever needed
export const RATE_LIMITS: Record<RateLimitRoute, { limit: number; windowSec: number }> = {
  login: { limit: 5, windowSec: 900 },
  register: { limit: 10, windowSec: 3600 },
  refresh: { limit: 30, windowSec: 900 },
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name)

  constructor(private readonly bullMq: BullMqService) {}

  /** Fixed-window counter: first hit sets the window TTL, throws 429 once the limit is exceeded. */
  async consume(route: RateLimitRoute, ip: string, email?: string): Promise<void> {
    const { limit, windowSec } = RATE_LIMITS[route]
    // lowercase only the key — the email lookup elsewhere stays case-sensitive
    const key = `rl:${route}:${ip}:${email?.toLowerCase() ?? '-'}`
    // ponytail: rides BullMQ's connection (maxRetriesPerRequest=null), so a Redis outage stalls
    // auth instead of failing open; switch to a dedicated short-retry client if that matters
    const redis = this.bullMq.redis
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, windowSec)
    if (count > limit) {
      this.logger.warn(`Rate limit exceeded: ${route} ${ip} ${email?.toLowerCase() ?? '-'}`)
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }
}
