import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, LessThan, Repository, type EntityManager } from 'typeorm'
import * as argon2 from 'argon2'
import { User } from './entities/user.entity'
import { RefreshToken } from './entities/refresh-token.entity'
import { TokenService } from './tokens/token.service'
import { RateLimitService } from './rate-limit.service'
import { hashPassword } from './password'
import { isPostgresUniqueViolation } from '../assets/assets.service'
import type { AuthResponse } from '@photox/shared-types'

// argon2id hash of a throwaway password (generated once with the pinned options); verified
// against for unknown emails so both 401 paths pay the same cost
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$QZuG/mblvx/n3SXlX9r3uw$Vo0UNhRloCRz9xDVfibLrw9XJYAgo/gQQ5nhGrdtJEo'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RefreshToken) private readonly tokenRepo: Repository<RefreshToken>,
    private readonly tokenService: TokenService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async register(
    email: string,
    password: string,
    displayName: string,
    ip: string,
  ): Promise<AuthResponse> {
    await this.rateLimit.consume('register', ip)

    const existing = await this.userRepo.findOne({ where: { email } })
    if (existing) throw new ConflictException('Email already registered')

    // ponytail: open registration never mints admin — the first-admin bootstrap was a
    // check-then-insert race (two concurrent count()===0 both won). Promote via DB/seed instead.
    const passwordHash = await hashPassword(password)
    const user = this.userRepo.create({ email, passwordHash, displayName, role: 'user' })
    try {
      const saved = await this.userRepo.save(user)
      return this.issueTokens(saved)
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        throw new ConflictException('Email already registered')
      }
      throw err
    }
  }

  async login(email: string, password: string, ip: string): Promise<AuthResponse> {
    // per-IP bucket first, then the per-(ip,email) one, so email rotation can't multiply attempts
    await this.rateLimit.consume('loginIp', ip)
    await this.rateLimit.consume('login', ip, email)

    const user = await this.userRepo.findOne({ where: { email } })
    // unknown email still pays one verify against the dummy hash, so the two 401 paths cost the same
    const valid = await argon2.verify(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password)
    if (!user || !valid) {
      this.logger.warn(`Login failed for ${email}`)
      throw new UnauthorizedException('Invalid credentials')
    }

    return this.issueTokens(user)
  }

  async refresh(refreshToken: string, ip: string): Promise<AuthResponse> {
    await this.rateLimit.consume('refresh', ip)

    // C5: opportunistic purge of expired refresh rows — single indexed query, best-effort.
    // Never fails auth: any error is swallowed so a DB blip on the purge can't lock users out.
    try {
      await this.tokenRepo.delete({ expiresAt: LessThan(new Date()) })
    } catch {
      // ignore — the refresh below is authoritative
    }

    const hash = this.tokenService.hash(refreshToken)

    const row = await this.tokenRepo.findOne({
      where: { tokenHash: hash },
    })
    if (!row) throw new UnauthorizedException('Invalid refresh token')
    if (new Date() > row.expiresAt) throw new UnauthorizedException('Refresh token expired')
    if (row.absoluteExpiresAt && new Date() > row.absoluteExpiresAt)
      throw new UnauthorizedException('Refresh token expired')

    const result = await this.tokenRepo.update(
      { tokenHash: hash, revokedAt: IsNull() },
      { revokedAt: () => 'now()' },
    )
    if (!result.affected) {
      // reused (already rotated/revoked) token — assume theft: drop the whole family and
      // floor access tokens in the same transaction so stolen cookies die with it
      await this.userRepo.manager.transaction((m) => this.revokeAllSessions(row.userId, m))
      this.logger.warn(`Refresh token reuse for user ${row.userId}; all refresh tokens revoked`)
      throw new UnauthorizedException('Refresh token revoked')
    }

    const user = await this.userRepo.findOne({ where: { id: row.userId } })
    if (!user) throw new NotFoundException('User not found')

    return this.issueTokens(user, row.absoluteExpiresAt)
  }

  // ponytail: global logout kills every device session — per-jti denylist if selective logout matters
  async revokeAllSessions(userId: string, manager?: EntityManager): Promise<void> {
    const store = manager ?? this.userRepo.manager
    await store.delete(RefreshToken, { userId })
    await store.update(User, userId, { tokensValidAfter: new Date() })
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = this.tokenService.hash(refreshToken)

    const row = await this.tokenRepo.findOne({
      where: { tokenHash: hash },
    })
    // unknown token scopes to no user — idempotent no-op (still 204)
    if (!row) return
    await this.userRepo.manager.transaction((m) => this.revokeAllSessions(row.userId, m))
  }

  private async issueTokens(user: User, absoluteExpiresAt?: Date | null): Promise<AuthResponse> {
    const accessToken = await this.tokenService.signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    })

    const refreshRaw = this.tokenService.generate()
    const refreshHash = this.tokenService.hash(refreshRaw)

    // ponytail: hardcoded 7d absolute session cap — promote to env if it needs tuning
    const absolute = absoluteExpiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const sliding = this.tokenService.getRefreshExpiresAt()

    await this.tokenRepo.save(
      this.tokenRepo.create({
        userId: user.id,
        tokenHash: refreshHash,
        expiresAt: sliding < absolute ? sliding : absolute,
        absoluteExpiresAt: absolute,
      }),
    )

    return {
      accessToken,
      accessTokenExpiresIn: this.tokenService.expiresInSeconds(accessToken),
      refreshToken: refreshRaw,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    }
  }
}
