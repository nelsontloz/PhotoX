import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, uploadForUser } from './helpers'
import type { FileRecord } from '@photox/shared-types'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('GET /v1/files/:fileId', () => {
  it('UC-U5: returns 200 with FileRecordDto for own file', async () => {
    const userId = mintUserId()
    const record = await uploadForUser(
      httpServer,
      userId,
      'photo.jpg',
      Buffer.from('photo-data'),
      'image/jpeg',
    )

    const res = await supertest(httpServer)
      .get(`/v1/files/${record.id}`)
      .query({ userId })
      .expect(200)

    const body = res.body as FileRecord
    expect(body.id).toBe(record.id)
    expect(body.userId).toBe(userId)
    expect(body.originalName).toBe('photo.jpg')
    expect(body.mimeType).toBe('image/jpeg')
    expect(Number(body.sizeBytes)).toBe(record.sizeBytes)
    expect(body.checksumSha256).toBe(record.checksumSha256)
    expect(typeof body.createdAt).toBe('string')
  })

  it("UC-U6: returns 404 for someone else's file (not 403)", async () => {
    const owner = mintUserId()
    const other = mintUserId()
    const record = await uploadForUser(
      httpServer,
      owner,
      'secret.jpg',
      Buffer.from('secret'),
      'image/jpeg',
    )

    const res = await supertest(httpServer)
      .get(`/v1/files/${record.id}`)
      .query({ userId: other })
      .expect(404)

    expect(res.body).toBeDefined()
  })

  it('returns 404 for a non-existent file', async () => {
    const userId = mintUserId()

    await supertest(httpServer)
      .get('/v1/files/00000000-0000-0000-0000-000000000000')
      .query({ userId })
      .expect(404)
  })
})
