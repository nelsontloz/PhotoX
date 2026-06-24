import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { MinioService } from '../../src/storage/minio.service'
import { createTestApp, closeTestApp, mintUserId, uploadForUser } from './helpers'

let app: INestApplication
let httpServer: Server
let minioService: MinioService

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
  minioService = app.get(MinioService)
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('DELETE /v1/files/:fileId', () => {
  it('UC-I5: cascading delete — DB row gone, MinIO object gone', async () => {
    const userId = mintUserId()
    const content = Buffer.from('cascade-target')
    const record = await uploadForUser(httpServer, userId, 'cascade.png', content, 'image/png')

    await supertest(httpServer).delete(`/v1/files/${record.id}`).query({ userId }).expect(204)

    await supertest(httpServer).get(`/v1/files/${record.id}`).query({ userId }).expect(404)

    const minioExists = await minioService.fileExists(record.storageKey)
    expect(minioExists).toBe(false)
  })

  it('UC-I5: idempotent on second call', async () => {
    const userId = mintUserId()
    const content = Buffer.from('idempotent-cascade')
    const record = await uploadForUser(httpServer, userId, 'idem.png', content, 'image/png')

    await supertest(httpServer).delete(`/v1/files/${record.id}`).query({ userId }).expect(204)

    await supertest(httpServer).delete(`/v1/files/${record.id}`).query({ userId }).expect(204)
  })
})
