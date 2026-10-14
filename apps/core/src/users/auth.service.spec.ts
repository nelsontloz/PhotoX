import { ConflictException } from '@nestjs/common'
import { QueryFailedError } from 'typeorm'
import { getMetadataArgsStorage } from 'typeorm'
import { AuthService } from './auth.service'
import { RefreshToken } from './entities/refresh-token.entity'
import type { TokenService } from './tokens/token.service'
import type { RateLimitService } from './rate-limit.service'

vi.mock('./password', () => ({
  hashPassword: vi.fn(() => Promise.resolve('hashed')),
}))

function uniqueViolation(): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO "users"("email") VALUES ($1)',
    ['dup@example.com'],
    Object.assign(new Error('duplicate key value violates unique constraint "UQ_email"'), {
      code: '23505',
    }),
  )
}

function makeRegisterService(save: () => Promise<never> | Promise<unknown>) {
  const saveMock = vi.fn(save)
  const userRepo = {
    findOne: vi.fn(() => Promise.resolve(null)),
    create: vi.fn((v: unknown) => v),
    save: saveMock,
  }
  const service = new AuthService(
    userRepo as never,
    {} as never,
    {
      signAccessToken: vi.fn(() => Promise.resolve('access')),
      generate: () => 'raw',
      hash: () => 'hash',
      getRefreshExpiresAt: () => new Date(),
    } as unknown as TokenService,
    { consume: vi.fn(() => Promise.resolve()) } as unknown as RateLimitService,
  )
  return { service, saveMock }
}

describe('AuthService.register concurrent duplicate (C1)', () => {
  it('maps a Postgres unique violation to 409 instead of 500', async () => {
    const err = uniqueViolation()
    const { service } = makeRegisterService(() => Promise.reject(err))
    // issueTokens would need a saved user — stub it by making save throw before it
    const caught: unknown = await service
      .register('dup@example.com', 'pw123456', 'Dup', '1.2.3.4')
      .then(
        () => null,
        (e: unknown) => e,
      )
    expect(caught).toBeInstanceOf(ConflictException)
    expect((caught as ConflictException).message).toBe('Email already registered')
  })

  it('rethrows non-unique errors untouched', async () => {
    const err = new Error('connection lost')
    const { service } = makeRegisterService(() => Promise.reject(err))
    await expect(service.register('a@b.c', 'pw123456', 'A', '1.2.3.4')).rejects.toBe(err)
  })
})

function makeRefreshService(opts: {
  purge: () => Promise<unknown>
  row?: unknown
  updateResult?: { affected: number | null }
  user?: unknown
}) {
  const purgeMock = vi.fn(opts.purge)
  const tokenRepo = {
    delete: purgeMock,
    findOne: vi.fn(() => Promise.resolve(opts.row ?? null)),
    update: vi.fn(() => Promise.resolve(opts.updateResult ?? { affected: 1 })),
    save: vi.fn((v: unknown) => Promise.resolve(v)),
    create: vi.fn((v: unknown) => v),
  }
  const userRepo = {
    findOne: vi.fn(() => Promise.resolve(opts.user ?? null)),
    manager: { transaction: vi.fn((fn: (m: unknown) => Promise<unknown>) => fn({})) },
  }
  const service = new AuthService(
    userRepo as never,
    tokenRepo as never,
    {
      hash: () => 'hash',
      generate: () => 'raw-refresh',
      getRefreshExpiresAt: () => new Date(Date.now() + 1000),
      signAccessToken: vi.fn(() => Promise.resolve('access')),
    } as unknown as TokenService,
    { consume: vi.fn(() => Promise.resolve()) } as unknown as RateLimitService,
  )
  return { service, purgeMock, tokenRepo, userRepo }
}

describe('AuthService.refresh opportunistic purge (C5)', () => {
  const row = {
    userId: 'u1',
    tokenHash: 'hash',
    expiresAt: new Date(Date.now() + 60_000),
    absoluteExpiresAt: null,
  }
  const user = {
    id: 'u1',
    email: 'u@example.com',
    role: 'user',
    displayName: 'U',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  it('purges expired rows on the refresh path', async () => {
    const { service, purgeMock } = makeRefreshService({
      purge: () => Promise.resolve({ affected: 0 }),
      row,
      user,
    })
    await service.refresh('refresh-token', '1.2.3.4')
    expect(purgeMock).toHaveBeenCalledOnce()
  })

  it('never fails auth when the purge rejects', async () => {
    const { service } = makeRefreshService({
      purge: () => Promise.reject(new Error('db blip')),
      row,
      user,
    })
    const res = await service.refresh('refresh-token', '1.2.3.4')
    expect(res.accessToken).toBe('access')
  })

  it('keeps expiresAt indexed for the purge query', () => {
    const indices = getMetadataArgsStorage().indices.filter((i) => i.target === RefreshToken)
    const coversExpiresAt = indices.some((i) => {
      const rec = i as unknown as Record<string, unknown>
      const prop = rec.propertyName as string | undefined
      const props = (rec.properties ?? []) as string[]
      const cols = (rec.columns ?? []) as unknown[]
      return prop === 'expiresAt' || props.includes('expiresAt') || cols.includes('expiresAt')
    })
    expect(coversExpiresAt).toBe(true)
  })
})
