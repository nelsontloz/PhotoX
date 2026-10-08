import { HttpException } from '@nestjs/common'
import type { BullMqService } from '../queue/bullmq.service'
import { RATE_LIMITS, RateLimitService } from './rate-limit.service'

class FakeRedis {
  readonly counts = new Map<string, number>()
  readonly expirations: [string, number][] = []

  incr(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1
    this.counts.set(key, next)
    return Promise.resolve(next)
  }

  expire(key: string, windowSec: number): Promise<number> {
    this.expirations.push([key, windowSec])
    return Promise.resolve(1)
  }
}

function makeService() {
  const redis = new FakeRedis()
  const service = new RateLimitService({ redis } as unknown as BullMqService)
  return { service, redis }
}

describe('RateLimitService', () => {
  it('allows hits up to the limit, then throws 429', async () => {
    const { service } = makeService()

    for (let i = 0; i < RATE_LIMITS.login.limit; i++) {
      await service.consume('login', '1.2.3.4', 'user@example.com')
    }

    const err = await service
      .consume('login', '1.2.3.4', 'user@example.com')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpException)
    expect((err as HttpException).getStatus()).toBe(429)
  })

  it('sets the window TTL only on the first hit', async () => {
    const { service, redis } = makeService()

    await service.consume('refresh', '1.2.3.4')
    await service.consume('refresh', '1.2.3.4')

    expect(redis.expirations).toEqual([['rl:refresh:1.2.3.4:-', RATE_LIMITS.refresh.windowSec]])
  })

  it('scopes keys by route and ip, lowercases the email, and uses - when absent', async () => {
    const { service, redis } = makeService()

    await service.consume('login', '1.2.3.4', 'Mixed@Example.com')
    await service.consume('login', '5.6.7.8', 'mixed@example.com')
    await service.consume('register', '1.2.3.4')

    expect([...redis.counts.entries()]).toEqual([
      ['rl:login:1.2.3.4:mixed@example.com', 1],
      ['rl:login:5.6.7.8:mixed@example.com', 1],
      ['rl:register:1.2.3.4:-', 1],
    ])
  })
})
