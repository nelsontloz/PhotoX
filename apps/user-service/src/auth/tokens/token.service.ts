import { Injectable, Inject } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { loadEnv } from '@photox/shared-config'
import type { JwtPayload } from '@photox/shared-auth'

export const AUTH_CLOCK_TOLERANCE = 'AUTH_CLOCK_TOLERANCE_SEC'

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(AUTH_CLOCK_TOLERANCE) private readonly clockToleranceSec: number,
  ) {}

  signAccessToken(user: { id: string; email: string }): Promise<string> {
    return this.jwtService.signAsync({ sub: user.id, email: user.email, jti: randomUUID() })
  }

  verifyAccessToken(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token, {
      algorithms: ['HS256'],
      clockTolerance: this.clockToleranceSec,
    })
  }

  generate(): string {
    return randomBytes(32).toString('base64url')
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  getRefreshExpiresAt(): Date {
    const env = loadEnv()
    const ms = this.parseDuration(env.AUTH_REFRESH_TTL)
    return new Date(Date.now() + ms)
  }

  private parseDuration(duration: string): number {
    const match = /^(\d+)([mhd])$/.exec(duration)
    if (!match) return 15 * 60 * 1000

    const [, valueStr, unit] = match
    const value = parseInt(valueStr!, 10)
    switch (unit) {
      case 'm':
        return value * 60 * 1000
      case 'h':
        return value * 60 * 60 * 1000
      case 'd':
        return value * 24 * 60 * 60 * 1000
      default:
        return 15 * 60 * 1000
    }
  }
}
