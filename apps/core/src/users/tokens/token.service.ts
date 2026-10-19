import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { loadEnv } from '@photox/shared-config'
import type { Role } from '@photox/shared-types'

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  signAccessToken(user: { id: string; email: string; role: Role }): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        jti: randomUUID(),
      },
      // kid names the signing secret ('cur' = AUTH_TOKEN_SECRET); rotation verifiers try
      // current, then AUTH_TOKEN_SECRET_PREVIOUS — no extra JwtModule needed
      { keyid: 'cur' },
    )
  }

  // remaining lifetime of an access token for the cookie's maxAge; 0 when it has no exp
  accessCookieMaxAge(accessToken: string): number {
    const exp = this.accessTokenExp(accessToken)
    if (!exp) return 0
    return Math.max(0, exp * 1000 - Date.now())
  }

  // seconds until the access token's own exp — the wire AuthResponse mirrors this instead of
  // re-reading AUTH_ACCESS_TTL; 0 when it has no exp (our signer always sets one)
  accessTokenExpiresIn(accessToken: string): number {
    const exp = this.accessTokenExp(accessToken)
    if (!exp) return 0
    return Math.max(0, exp - Math.floor(Date.now() / 1000))
  }

  private accessTokenExp(accessToken: string): number | undefined {
    return this.jwtService.decode<{ exp?: number } | null>(accessToken)?.exp
  }

  generate(): string {
    return randomBytes(32).toString('base64url')
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  getRefreshExpiresAt(): Date {
    return new Date(Date.now() + loadEnv().AUTH_REFRESH_TTL)
  }
}
