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
  it('UC-U9: deletes my file — subsequent GET returns 404, MinIO object gone', async () => {
    const userId = mintUserId()
    const content = Buffer.from('to-be-deleted')
    const record = await uploadForUser(httpServer, userId, 'delete-me.png', content, 'image/png')

    await supertest(httpServer)
      .delete(`/v1/files/${record.id}`)
      .set('x-user-id', userId)
      .expect(204)

    await supertest(httpServer).get(`/v1/files/${record.id}`).set('x-user-id', userId).expect(404)

    const minioExists = await minioService.fileExists(record.storageKey)
    expect(minioExists).toBe(false)
  })

  it('UC-U10: deleting an already-deleted file returns 204 (idempotent)', async () => {
    const userId = mintUserId()
    const content = Buffer.from('already-deleted')
    const record = await uploadForUser(httpServer, userId, 'gone.png', content, 'image/png')

    await supertest(httpServer)
      .delete(`/v1/files/${record.id}`)
      .set('x-user-id', userId)
      .expect(204)

    await supertest(httpServer)
      .delete(`/v1/files/${record.id}`)
      .set('x-user-id', userId)
      .expect(204)
  })

  it("UC-U11: deleting someone else's file does not delete it", async () => {
    const owner = mintUserId()
    const other = mintUserId()
    const content = Buffer.from('owner-protected')
    const record = await uploadForUser(httpServer, owner, 'protected.png', content, 'image/png')

    await supertest(httpServer).delete(`/v1/files/${record.id}`).set('x-user-id', other).expect(204)

    const res = await supertest(httpServer)
      .get(`/v1/files/${record.id}`)
      .set('x-user-id', owner)
      .expect(200)

    const body = res.body as { id: string }
    expect(body.id).toBe(record.id)

    const minioExists = await minioService.fileExists(record.storageKey)
    expect(minioExists).toBe(true)
  })
})
