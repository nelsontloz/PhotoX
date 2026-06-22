/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import path from 'node:path'
import * as argon2 from 'argon2'
import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { User } from '../../../../src/entities/user.entity'
import { RefreshToken } from '../../../../src/entities/refresh-token.entity'
import { AuthModule } from '../../../../src/auth/auth.module'
import { createMockRepo } from './mock-repos'
import type { MockRepos } from './mock-repos'

export const PACT_DIR = path.resolve(__dirname, '../../../../../../pacts')

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
