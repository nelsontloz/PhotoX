import path from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import { setupMockedApp, PACT_DIR } from './verifier'
import type { INestApplication } from '@nestjs/common'

let app: INestApplication
let url: string
let repos: Awaited<ReturnType<typeof setupMockedApp>>['repos']
let hash: string

beforeAll(async () => {
  const setup = await setupMockedApp()
  app = setup.app
  url = setup.url
  repos = setup.repos
  hash = setup.hash
}, 60_000)

afterAll(async () => {
  await app?.close()
})

describe('Pact verification — user-service', () => {
  it('validates expectations of Gateway', async () => {
    await new Verifier({
      provider: 'user-service',
      providerBaseUrl: url,
      pactUrls: [path.join(PACT_DIR, 'gateway-user-service.json')],
      logLevel: 'error',
      stateHandlers: {
        'a user can be registered': () => {
          repos.mockUserRepo.findOne.mockResolvedValue(null)
          return Promise.resolve()
        },
        'user exists with email user@test.com': () => {
          repos.mockUserRepo.findOne.mockResolvedValue({
            id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            email: 'user@test.com',
            passwordHash: hash,
            displayName: 'Test User',
            avatarUrl: null,
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          })
          return Promise.resolve()
        },
        'a valid refresh token exists': () => {
          repos.mockUserRepo.findOne.mockResolvedValue({
            id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            email: 'user@test.com',
            passwordHash: hash,
            displayName: 'Test User',
            avatarUrl: null,
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          })
          repos.mockRefreshTokenRepo.findOne.mockResolvedValue({
            id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
            userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            tokenHash: 'some-existing-hash',
            purpose: 'refresh',
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            revokedAt: null,
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          })
          return Promise.resolve()
        },
        'email new@test.com is already registered': () => {
          repos.mockUserRepo.findOne.mockResolvedValue({
            id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            email: 'new@test.com',
            passwordHash: hash,
            displayName: 'New User',
            avatarUrl: null,
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          })
          return Promise.resolve()
        },
        'login credentials are invalid': () => {
          repos.mockUserRepo.findOne.mockResolvedValue(null)
          return Promise.resolve()
        },
        'refresh token is invalid or revoked': () => {
          repos.mockRefreshTokenRepo.findOne.mockResolvedValue(null)
          return Promise.resolve()
        },
        'admin lists all users': () => {
          const createdAt = new Date('2024-01-01T00:00:00.000Z')
          const users = [
            {
              id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
              displayName: 'Ada Lovelace',
              email: 'ada@example.com',
              role: 'user' as const,
              createdAt,
            },
            {
              id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
              displayName: 'Grace Hopper',
              email: 'grace@example.com',
              role: 'admin' as const,
              createdAt,
            },
          ]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const qb = repos.mockUserRepo.createQueryBuilder()
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          qb.getManyAndCount.mockResolvedValueOnce([users, users.length])
          return Promise.resolve()
        },
      },
    }).verifyProvider()
  }, 30_000)
})
