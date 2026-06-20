import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import supertest from 'supertest'
import { setupTestInfra, teardownTestInfra } from './test-setup'
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter'
import type { Asset } from '@photox/shared-types'

export async function createTestApp(): Promise<{ app: INestApplication; httpServer: Server }> {
  await setupTestInfra()

  // @ts-expect-error dynamic import — vitest resolves test→src paths
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { AppModule } = await import('../../src/app.module')

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile()

  const app = module.createNestApplication()
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.init()

  const httpServer = app.getHttpServer() as Server
  return { app, httpServer }
}

export async function closeTestApp(app: INestApplication): Promise<void> {
  await app?.close()
  await teardownTestInfra()
}

export function mintUserId(): string {
  return randomUUID()
}

export function assetPayload(overrides?: {
  fileId?: string
  kind?: 'photo' | 'video'
  title?: string
  description?: string
  takenAt?: string
}) {
  return {
    fileId: randomUUID(),
    kind: 'photo' as const,
    ...overrides,
  }
}

export async function createAssetForUser(
  httpServer: Server,
  userId: string,
  overrides?: Parameters<typeof assetPayload>[0],
): Promise<Asset> {
  const res = await supertest(httpServer)
    .post('/v1/assets')
    .set('x-user-id', userId)
    .send(assetPayload(overrides))
    .expect(201)
  return res.body as Asset
}
