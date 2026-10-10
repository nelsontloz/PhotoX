import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { loadEnv } from '@photox/shared-config'
import type { Role } from '@photox/shared-types'

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  signAccessToken(user: { id: string; email: string; role: Role }): Promise<string> {
    return this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      jti: randomUUID(),
    })
  }

  // remaining lifetime of an access token for the cookie's maxAge; 0 when it has no exp
  accessCookieMaxAge(accessToken: string): number {
    const payload = this.jwtService.decode<{ exp?: number } | null>(accessToken)
    if (!payload?.exp) return 0
    return Math.max(0, payload.exp * 1000 - Date.now())
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
