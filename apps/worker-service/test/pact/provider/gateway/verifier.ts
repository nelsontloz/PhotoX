/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import path from 'node:path'
import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { JobRecord } from '../../../../src/queue/entities/job.entity'
import { PgBossService } from '../../../../src/queue/pg-boss.service'
import { QueueModule } from '../../../../src/queue/queue.module'
import { createJobRepo } from './mock-repos'
import type { MockRepos } from './mock-repos'

export const PACT_DIR = path.resolve(__dirname, '../../../../../../pacts')

export async function setupMockedApp(): Promise<{
  app: INestApplication
  url: string
  repos: MockRepos
}> {
  process.env.NODE_ENV = 'test'

  const mockJobRepo = createJobRepo()
  const mockPgBoss = {
    isConnected: vi.fn().mockReturnValue(false),
    createQueue: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'),
    work: vi.fn().mockResolvedValue(undefined),
  }
  const module = await Test.createTestingModule({
    imports: [QueueModule],
  })
    .overrideProvider(getRepositoryToken(JobRecord))
    .useValue(mockJobRepo)
    .overrideProvider(PgBossService)
    .useValue(mockPgBoss)
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
    repos: { mockJobRepo },
  }
}
