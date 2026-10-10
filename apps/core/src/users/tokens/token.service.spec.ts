import { JwtService } from '@nestjs/jwt'
import { TokenService } from './token.service'

const jwt = new JwtService({ secret: 'test-secret-0123456789abcdef0123456789' })
const service = new TokenService(jwt)

describe('TokenService.accessCookieMaxAge', () => {
  it('returns the remaining lifetime in ms for a token with exp', () => {
    const token = jwt.sign({ sub: 'u1', email: 'u@example.com', role: 'user' }, { expiresIn: 60 })
    const maxAge = service.accessCookieMaxAge(token)
    expect(maxAge).toBeGreaterThan(59_000)
    expect(maxAge).toBeLessThanOrEqual(60_000)
  })

  it('returns 0 for a token without exp and for garbage', () => {
    const noExp = jwt.sign({ sub: 'u1', email: 'u@example.com', role: 'user' })
    expect(service.accessCookieMaxAge(noExp)).toBe(0)
    expect(service.accessCookieMaxAge('not-a-token')).toBe(0)
  })
})
