import type { Mock } from 'vitest'
import * as argon2 from 'argon2'
import type { DataSource } from 'typeorm'
import { ADMIN_SEED_PROVIDER } from './database.module'

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
