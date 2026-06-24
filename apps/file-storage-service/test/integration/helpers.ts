import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { randomUUID, createHash } from 'node:crypto'
import type { Server } from 'node:http'
import supertest from 'supertest'
import { setupTestInfra, teardownTestInfra } from './test-setup'
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter'
import type { FileRecord } from '@photox/shared-types'

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

export async function uploadForUser(
  httpServer: Server,
  userId: string,
  filename: string,
  content: Buffer,
  mimeType: string,
): Promise<FileRecord> {
  const res = await supertest(httpServer)
    .post('/v1/files')
    .field('userId', userId)
    .attach('file', content, { filename, contentType: mimeType })
    .expect(201)
  return res.body as FileRecord
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}
