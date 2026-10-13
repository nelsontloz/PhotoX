import type { Mock } from 'vitest'
import * as argon2 from 'argon2'
import type { DataSource } from 'typeorm'
import { ADMIN_SEED_PROVIDER, DatabaseModule } from './database.module'

const EMAIL = 'admin-seed@example.com'
const PASSWORD = 'seed-password-123'

describe('ADMIN_SEED bootstrap', () => {
  const prevEmail = process.env.ADMIN_EMAIL
  const prevPassword = process.env.ADMIN_PASSWORD

  beforeEach(() => {
    delete process.env.ADMIN_EMAIL
    delete process.env.ADMIN_PASSWORD
  })

  afterAll(() => {
    if (prevEmail === undefined) delete process.env.ADMIN_EMAIL
    else process.env.ADMIN_EMAIL = prevEmail
    if (prevPassword === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = prevPassword
  })

  function bootstrap(query: Mock) {
    const hook = ADMIN_SEED_PROVIDER.useFactory({ query } as unknown as DataSource)
    return hook.onApplicationBootstrap()
  }

  it('is a no-op when neither ADMIN_EMAIL nor ADMIN_PASSWORD is set', async () => {
    const query = vi.fn()
    await bootstrap(query)
    expect(query).not.toHaveBeenCalled()
  })

  it('skips on partial env without touching the database', async () => {
    process.env.ADMIN_EMAIL = EMAIL
    const query = vi.fn()
    await bootstrap(query)
    expect(query).not.toHaveBeenCalled()
  })

  it('inserts the admin with a verifiable argon2 hash when no admin exists', async () => {
    process.env.ADMIN_EMAIL = EMAIL
    process.env.ADMIN_PASSWORD = PASSWORD
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await bootstrap(query)
    expect(query).toHaveBeenCalledTimes(2)
    const [sql, params] = query.mock.calls[1] as [string, [string, string, string]]
    expect(sql).toMatch(/role.*admin/)
    expect(params[1]).toBe(EMAIL)
    expect(await argon2.verify(params[2], PASSWORD)).toBe(true)
  })

  it('does nothing when an admin already exists', async () => {
    process.env.ADMIN_EMAIL = EMAIL
    process.env.ADMIN_PASSWORD = PASSWORD
    const query = vi.fn().mockResolvedValueOnce([{ '?column?': 1 }])
    await bootstrap(query)
    expect(query).toHaveBeenCalledTimes(1)
  })
})

describe('forRoot synchronize gate', () => {
  const prevNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNodeEnv
  })

  function findSynchronize(node: unknown, seen = new Set<unknown>()): unknown {
    if (node === null || typeof node !== 'object' || seen.has(node)) return undefined
    seen.add(node)
    const rec = node as Record<string, unknown>
    if ('synchronize' in rec) return rec.synchronize
    for (const v of Object.values(rec)) {
      const r = findSynchronize(v, seen)
      if (r !== undefined) return r
    }
    return undefined
  }

  it('disables synchronize in production', () => {
    process.env.NODE_ENV = 'production'
    expect(findSynchronize(DatabaseModule.forRoot())).toBe(false)
  })

  it('enables synchronize elsewhere', () => {
    process.env.NODE_ENV = 'test'
    expect(findSynchronize(DatabaseModule.forRoot())).toBe(true)
    delete process.env.NODE_ENV
    expect(findSynchronize(DatabaseModule.forRoot())).toBe(true)
  })
})
