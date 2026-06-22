import { describe, it, expect } from 'vitest'
import { getAccessTokenExp } from './jwt'

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `${header}.${body}.sig`
}

describe('getAccessTokenExp', () => {
  it('returns numeric exp from a valid JWT', () => {
    const exp = 1700000000
    const token = makeJwt({ sub: 'u1', email: 'a@b.com', iat: 1699999000, exp })
    expect(getAccessTokenExp(token)).toBe(exp)
  })

  it('returns null for a garbage string', () => {
    expect(getAccessTokenExp('not-a-jwt')).toBeNull()
  })

  it('returns null when exp is missing', () => {
    const token = makeJwt({ sub: 'u1' })
    expect(getAccessTokenExp(token)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(getAccessTokenExp('')).toBeNull()
  })
})
