import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { User } from '../entities/user.entity'
import { RefreshToken } from '../entities/refresh-token.entity'
import { PasswordService } from './tokens/password.service'
import { TokenService } from './tokens/token.service'
import type { AuthResponse } from '@photox/shared-types'

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RefreshToken) private readonly tokenRepo: Repository<RefreshToken>,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  async register(email: string, password: string, displayName: string): Promise<AuthResponse> {
    const existing = await this.userRepo.findOne({ where: { email } })
    if (existing) throw new ConflictException('Email already registered')

    const passwordHash = await this.passwordService.hash(password)
    const user = this.userRepo.create({ email, passwordHash, displayName })
    const saved = await this.userRepo.save(user)

    return this.issueTokens(saved)
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const user = await this.userRepo.findOne({ where: { email } })
    if (!user) throw new UnauthorizedException('Invalid credentials')

    const valid = await this.passwordService.verify(user.passwordHash, password)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    return this.issueTokens(user)
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const hash = this.tokenService.hash(refreshToken)

    const row = await this.tokenRepo.findOne({
      where: { tokenHash: hash, purpose: 'refresh' as const },
    })
    if (!row) throw new UnauthorizedException('Invalid refresh token')
    if (row.revokedAt) throw new UnauthorizedException('Refresh token revoked')
    if (new Date() > row.expiresAt) throw new UnauthorizedException('Refresh token expired')

    await this.tokenRepo.update(row.id, { revokedAt: new Date() })

    const user = await this.userRepo.findOne({ where: { id: row.userId } })
    if (!user) throw new NotFoundException('User not found')

    return this.issueTokens(user)
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = this.tokenService.hash(refreshToken)

    const row = await this.tokenRepo.findOne({
      where: { tokenHash: hash, purpose: 'refresh' as const },
    })
    if (row && !row.revokedAt) {
      await this.tokenRepo.update(row.id, { revokedAt: new Date() })
    }
  }

  private async issueTokens(user: User): Promise<AuthResponse> {
    const accessToken = await this.tokenService.signAccessToken({
      id: user.id,
      email: user.email,
    })

    const refreshRaw = this.tokenService.generate()
    const refreshHash = this.tokenService.hash(refreshRaw)

    await this.tokenRepo.save(
      this.tokenRepo.create({
        userId: user.id,
        tokenHash: refreshHash,
        purpose: 'refresh' as const,
        expiresAt: this.tokenService.getRefreshExpiresAt(),
      }),
    )

    return {
      accessToken,
      refreshToken: refreshRaw,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? undefined,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    }
  }
}
