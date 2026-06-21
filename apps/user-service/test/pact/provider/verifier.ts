/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import path from 'node:path'
import * as argon2 from 'argon2'
import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { User } from '../../../src/entities/user.entity'
import { RefreshToken } from '../../../src/entities/refresh-token.entity'
import { AuthModule } from '../../../src/auth/auth.module'

export const PACT_DIR = path.resolve(__dirname, '../../../../../pacts')

export interface MockRepos {
  mockUserRepo: ReturnType<typeof createMockRepo>
  mockRefreshTokenRepo: ReturnType<typeof createMockRepo>
}

export async function setupMockedApp(): Promise<{
  app: INestApplication
  url: string
  repos: MockRepos
  hash: string
}> {
  process.env.AUTH_TOKEN_SECRET = 'pact-test-secret-at-least-32-characters!!'
  process.env.AUTH_CLOCK_TOLERANCE_SEC = '60'
  process.env.NODE_ENV = 'test'

  const hash = await argon2.hash('ValidPass123')

  const mockUserRepo = createMockRepo()
  const mockRefreshTokenRepo = createMockRepo()

  const module = await Test.createTestingModule({
    imports: [AuthModule],
  })
    .overrideProvider(getRepositoryToken(User))
    .useValue(mockUserRepo)
    .overrideProvider(getRepositoryToken(RefreshToken))
    .useValue(mockRefreshTokenRepo)
    .compile()

  const app = module.createNestApplication()
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  await app.listen(0)

  const url = await app.getUrl()

  return {
    app,
    url,
    repos: { mockUserRepo, mockRefreshTokenRepo },
    hash,
  }
}

export function createMockRepo() {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockImplementation((data: any) => ({
      ...data,
      id: data.id ?? 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: data.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: data.updatedAt ?? new Date('2024-01-01T00:00:00.000Z'),
      expiresAt: data.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })),
    create: vi.fn((data: any) => data),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    find: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
    createQueryBuilder: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    }),
  }
}
