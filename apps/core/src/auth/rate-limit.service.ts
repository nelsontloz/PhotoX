import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { apiError } from '../common/api-error';
import { BullMqService } from '../queue/bullmq.service';

type RateLimitRoute = 'login' | 'loginIp' | 'loginEmail' | 'register' | 'refresh';

// ponytail: fixed windows as a module constant — tune here; per-user/admin config if ever needed
export const RATE_LIMITS: Record<RateLimitRoute, { limit: number; windowSec: number }> = {
  login: { limit: 5, windowSec: 900 },
  // coarser per-IP bucket so email rotation can't multiply the per-email allowance
  loginIp: { limit: 20, windowSec: 900 },
  // per-account ceiling across IPs: distributed spraying at one address never trips loginIp
  loginEmail: { limit: 15, windowSec: 900 },
  register: { limit: 10, windowSec: 3600 },
  refresh: { limit: 30, windowSec: 900 },
};

// ponytail: register is env-overridable (direct process.env like WORKER_SERVICE_PORT, not zod)
// so the e2e suite can batched-register from one IP. Parsed per call so
// loadRootEnvFile() ordering can't bite; invalid/absent values fall back to the constant.
function routeLimit(route: RateLimitRoute): number {
  if (route !== 'register') return RATE_LIMITS[route].limit;
  const parsed = Number.parseInt(process.env.RATE_LIMIT_REGISTER ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : RATE_LIMITS.register.limit;
}

// atomic fixed window: INCR plus EXPIRE only when the window is created, so a crash can never
// leave a no-TTL key that permanently locks out the bucket
const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

// ponytail: 300ms budget — Redis down/slow rejects auth with 503 instead of hanging it
export const RATE_LIMIT_TIMEOUT_MS = 300;

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(private readonly bullMq: BullMqService) {}

  /**
   * Fixed-window counter: first hit sets the window TTL, throws 429 once the limit is exceeded.
   * Fails closed (503) when Redis is unavailable, not yet connected, or too slow — an
   * attacker must never get unlimited auth attempts from a Redis blip.
   */
  async consume(route: RateLimitRoute, ip: string, email?: string): Promise<void> {
    const { windowSec } = RATE_LIMITS[route];
    const limit = routeLimit(route);
    // encode segments so ':' in IPv6 addresses/emails can't alias another bucket;
    // lowercase only the key — the email lookup elsewhere stays case-sensitive.
    // loginEmail is account-scoped, so its key deliberately omits the IP.
    const account = encodeURIComponent(email?.toLowerCase() ?? '-');
    const key =
      route === 'loginEmail'
        ? `rl:${route}:${account}`
        : `rl:${route}:${encodeURIComponent(ip)}:${account}`;

    const count = await this.countHit(key, windowSec);
    if (count === null) {
      this.logger.warn(`Rate limit unavailable for ${route} (${key}); rejecting request`);
      throw apiError(503, 'RATE_LIMIT_UNAVAILABLE', 'Rate limiter unavailable');
    }

    if (count > limit) {
      this.logger.warn(`Rate limit exceeded: ${route} ${ip} ${email?.toLowerCase() ?? '-'}`);
      const retryAfterSec = await this.retryAfterSec(key, windowSec);
      throw apiError(429, 'RATE_LIMITED', 'Too many requests', { retryAfterSec });
    }
  }

  /** Remaining window in whole seconds; the route's configured window when Redis cannot say. */
  private async retryAfterSec(key: string, windowSec: number): Promise<number> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const redis: Redis | undefined = this.bullMq.redis;
      if (!redis) return windowSec;
      const pttl = await Promise.race([
        redis.pttl(key),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), RATE_LIMIT_TIMEOUT_MS);
        }),
      ]);
      return pttl === null || pttl < 0 ? windowSec : Math.max(1, Math.ceil(pttl / 1000));
    } catch {
      return windowSec;
    } finally {
      clearTimeout(timer);
    }
  }

  /** null = Redis unavailable/timed out (caller fails closed with 503). */
  private async countHit(key: string, windowSec: number): Promise<number | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const redis: Redis | undefined = this.bullMq.redis;
      if (!redis) return null; // undefined until BullMqService.onModuleInit
      return await Promise.race([
        redis.eval(RATE_LIMIT_SCRIPT, 1, key, windowSec) as Promise<number>,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), RATE_LIMIT_TIMEOUT_MS);
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
