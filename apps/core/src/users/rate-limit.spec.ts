import { HttpException, Logger } from '@nestjs/common'
import type { BullMqService } from '../queue/bullmq.service'
import { RATE_LIMITS, RATE_LIMIT_TIMEOUT_MS, RateLimitService } from './rate-limit.service'

class FakeRedis {
  readonly counts = new Map<string, number>()
  readonly expirations: [string, number][] = []

  eval(_script: string, _numKeys: number, key: string, windowSec: number): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1
    this.counts.set(key, next)
    if (next === 1) this.expirations.push([key, Number(windowSec)])
    return Promise.resolve(next)
  }
}

function makeService(redis: unknown) {
  const service = new RateLimitService({ redis } as unknown as BullMqService)
  return { service, redis: redis as FakeRedis }
}

describe('RateLimitService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('allows hits up to the limit, then throws 429', async () => {
    const { service } = makeService(new FakeRedis())

    for (let i = 0; i < RATE_LIMITS.login.limit; i++) {
      await service.consume('login', '1.2.3.4', 'user@example.com')
    }

    const err = await service
      .consume('login', '1.2.3.4', 'user@example.com')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpException)
    expect((err as HttpException).getStatus()).toBe(429)
  })

  it('reads RATE_LIMIT_REGISTER at call time', async () => {
    const prev = process.env.RATE_LIMIT_REGISTER
    const { service } = makeService(new FakeRedis())
    try {
      await service.consume('register', '1.2.3.4')
      process.env.RATE_LIMIT_REGISTER = '1'
      const err = await service.consume('register', '1.2.3.4').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(HttpException)
      expect((err as HttpException).getStatus()).toBe(429)
    } finally {
      if (prev === undefined) delete process.env.RATE_LIMIT_REGISTER
      else process.env.RATE_LIMIT_REGISTER = prev
    }
  })

  it('sets the window TTL only on the first hit', async () => {
    const { service, redis } = makeService(new FakeRedis())

    await service.consume('refresh', '1.2.3.4')
    await service.consume('refresh', '1.2.3.4')

    expect(redis.expirations).toEqual([['rl:refresh:1.2.3.4:-', RATE_LIMITS.refresh.windowSec]])
  })

  it('encodes key segments so colons cannot alias buckets', async () => {
    const { service, redis } = makeService(new FakeRedis())

    await service.consume('login', '::ffff:1.2.3.4', 'Mixed@Example.com')
    await service.consume('login', '1.2.3.4', 'mixed@example.com')
    await service.consume('register', '1.2.3.4')

    expect([...redis.counts.entries()]).toEqual([
      ['rl:login:%3A%3Affff%3A1.2.3.4:mixed%40example.com', 1],
      ['rl:login:1.2.3.4:mixed%40example.com', 1],
      ['rl:register:1.2.3.4:-', 1],
    ])
  })

  it('fails open and warns when Redis rejects', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { service } = makeService({ eval: () => Promise.reject(new Error('redis down')) })

    await expect(service.consume('login', '1.2.3.4', 'user@example.com')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Rate limit unavailable'))
  })

  it('fails open after the timeout when Redis never answers', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { service } = makeService({ eval: () => new Promise<never>(() => undefined) })

    const start = Date.now()
    await expect(service.consume('login', '1.2.3.4', 'user@example.com')).resolves.toBeUndefined()
    expect(Date.now() - start).toBeGreaterThanOrEqual(RATE_LIMIT_TIMEOUT_MS - 50)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Rate limit unavailable'))
  })

  it('fails open when the Redis connection is not ready', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { service } = makeService(undefined)

    await expect(service.consume('register', '1.2.3.4')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Rate limit unavailable'))
  })
})
