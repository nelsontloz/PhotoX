import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, Repository } from 'typeorm'
import * as argon2 from 'argon2'
import { User } from './entities/user.entity'
import { RefreshToken } from './entities/refresh-token.entity'
import { TokenService } from './tokens/token.service'
import { RateLimitService } from './rate-limit.service'
import type { AuthResponse } from '@photox/shared-types'

// pinned so hashes don't silently change with the library's defaults
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} satisfies argon2.Options

// argon2id hash of a throwaway password (generated once with ARGON2_OPTIONS); verified against
// for unknown emails so both 401 paths pay the same cost
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

    const existingCount = await this.userRepo.count()
    const role = existingCount === 0 ? 'admin' : 'user'
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS)
    const user = this.userRepo.create({ email, passwordHash, displayName, role })
    const saved = await this.userRepo.save(user)

    return this.issueTokens(saved)
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

    const hash = this.tokenService.hash(refreshToken)

    const row = await this.tokenRepo.findOne({
      where: { tokenHash: hash },
    })
    if (!row) throw new UnauthorizedException('Invalid refresh token')
    if (new Date() > row.expiresAt) throw new UnauthorizedException('Refresh token expired')

    const result = await this.tokenRepo.update(
      { tokenHash: hash, revokedAt: IsNull() },
      { revokedAt: () => 'now()' },
    )
    if (!result.affected) {
      // reused (already rotated/revoked) token — assume theft and revoke the whole family
      await this.tokenRepo.delete({ userId: row.userId })
      this.logger.warn(`Refresh token reuse for user ${row.userId}; all refresh tokens revoked`)
      throw new UnauthorizedException('Refresh token revoked')
    }

    const user = await this.userRepo.findOne({ where: { id: row.userId } })
    if (!user) throw new NotFoundException('User not found')

    return this.issueTokens(user)
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = this.tokenService.hash(refreshToken)

    const row = await this.tokenRepo.findOne({
      where: { tokenHash: hash },
    })
    if (row && !row.revokedAt) {
      await this.tokenRepo.update(row.id, { revokedAt: new Date() })
    }
  }

  private async issueTokens(user: User): Promise<AuthResponse> {
    const accessToken = await this.tokenService.signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    })

    const refreshRaw = this.tokenService.generate()
    const refreshHash = this.tokenService.hash(refreshRaw)

    await this.tokenRepo.save(
      this.tokenRepo.create({
        userId: user.id,
        tokenHash: refreshHash,
        expiresAt: this.tokenService.getRefreshExpiresAt(),
      }),
    )

    return {
      accessToken,
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
