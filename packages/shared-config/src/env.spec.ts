import { afterEach, describe, expect, it } from 'vitest'
import { loadEnv } from './env'

describe('AUTH_REFRESH_TTL parsing', () => {
  const original = process.env.AUTH_REFRESH_TTL
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_REFRESH_TTL
    else process.env.AUTH_REFRESH_TTL = original
  })

  it('parses duration units to milliseconds', () => {
    process.env.AUTH_REFRESH_TTL = '2h'
    expect(loadEnv().AUTH_REFRESH_TTL).toBe(2 * 60 * 60 * 1000)
  })

  it('defaults to 30d when unset', () => {
    delete process.env.AUTH_REFRESH_TTL
    expect(loadEnv().AUTH_REFRESH_TTL).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('falls back to 15 minutes for an unparseable value', () => {
    process.env.AUTH_REFRESH_TTL = 'garbage'
    expect(loadEnv().AUTH_REFRESH_TTL).toBe(15 * 60 * 1000)
  })
})
