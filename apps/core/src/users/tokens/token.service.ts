import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { loadAuthEnv, loadEnv } from '@photox/shared-config'
import type { JwtPayload, Role } from '@photox/shared-types'

@Injectable()
export class TokenService {
  /**
   * Auth secrets + clock tolerance used by `verifyAccessToken`, resolved on FIRST USE and
   * cached afterwards. Never read in the constructor: the unit spec builds TokenService
   * without any auth env, and host dev loads the root .env after the module graph is
   * imported. A secret rotation implies a restart, so the cache never goes stale.
   */
  private authSecrets?: { user: string; previous?: string; clockTolerance: number }

  constructor(private readonly jwtService: JwtService) {}

  signAccessToken(
    user: { id: string; email: string; role: Role },
    sessionStartedAt?: Date,
  ): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        jti: randomUUID(),
        // the guard rejects once sst is a full ABSOLUTE_SESSION_MS old, even when renewing
        ...(sessionStartedAt ? { sst: Math.floor(sessionStartedAt.getTime() / 1000) } : {}),
      },
      // kid names the signing secret ('cur' = AUTH_TOKEN_SECRET); rotation verifiers try
      // current, then AUTH_TOKEN_SECRET_PREVIOUS — no extra JwtModule needed
      { keyid: 'cur' },
    )
  }

  /**
   * Verifies an ACCESS token against the USER secrets only — the current
   * `AUTH_TOKEN_SECRET` first, then the rotation overlap `AUTH_TOKEN_SECRET_PREVIOUS`.
   * The worker secret is deliberately never tried: a delegated service token must not be
   * able to revoke a user's sessions (that would be a DoS), so worker-minted tokens fail
   * closed here even though the guard accepts them on the worker job surface.
   *
   * Returns the token subject, or null when the token is malformed, expired, signed with a
   * foreign secret, or carries a delegated `act` claim — the caller must then treat the
   * request as unauthenticated and raise no session floor.
   */
  verifyAccessToken(token: string): { sub: string } | null {
    const secrets = this.resolveAuthSecrets()
    if (!secrets) return null

    const candidates = [secrets.user, ...(secrets.previous ? [secrets.previous] : [])]
    for (const secret of candidates) {
      let payload: JwtPayload
      try {
        payload = this.jwtService.verify<JwtPayload>(token, {
          secret,
          algorithms: ['HS256'],
          clockTolerance: secrets.clockTolerance,
        })
      } catch {
        // wrong secret / expired / malformed — try the next candidate, else fail closed
        continue
      }
      // a delegated service token is not a session credential
      if (payload.act) continue
      // only the two known roles are session credentials; anything else is forged
      if (payload.role !== 'user' && payload.role !== 'admin') continue
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) continue
      return { sub: payload.sub }
    }
    return null
  }

  // seconds until the access token's own exp — the wire AuthResponse and the access cookie's
  // maxAge both derive from it instead of re-reading AUTH_ACCESS_TTL; 0 when it has no exp
  // (our signer always sets one)
  expiresInSeconds(accessToken: string): number {
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

  /**
   * Resolves the auth secrets + clock tolerance `verifyAccessToken` needs. Cached after the
   * first successful load; an unusable env (missing or invalid secrets) yields null so the
   * caller fails closed. The failure is NOT cached — the env may become usable later (host
   * dev loads the root .env after import).
   */
  private resolveAuthSecrets(): { user: string; previous?: string; clockTolerance: number } | null {
    if (this.authSecrets) return this.authSecrets
    try {
      const auth = loadAuthEnv()
      this.authSecrets = {
        user: auth.AUTH_TOKEN_SECRET,
        ...(auth.AUTH_TOKEN_SECRET_PREVIOUS ? { previous: auth.AUTH_TOKEN_SECRET_PREVIOUS } : {}),
        clockTolerance: loadEnv().AUTH_CLOCK_TOLERANCE_SEC,
      }
    } catch {
      // unusable auth env — fail closed, no session is revoked
      return null
    }
    return this.authSecrets
  }
}
