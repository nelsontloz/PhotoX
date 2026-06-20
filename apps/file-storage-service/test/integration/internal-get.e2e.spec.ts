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

describe('GET /v1/internal/files/:fileId', () => {
  it('UC-I1: resolves a file by ID without x-user-id filter', async () => {
    const userId = mintUserId()
    const record = await uploadForUser(httpServer, userId, 'doc.pdf', Buffer.from('pdf-data'), 'application/pdf')

    const res = await supertest(httpServer)
      .get(`/v1/internal/files/${record.id}`)
      .expect(200)

    const body = res.body as FileRecord
    expect(body.id).toBe(record.id)
    expect(body.userId).toBe(userId)
    expect(body.originalName).toBe('doc.pdf')
    expect(body.mimeType).toBe('application/pdf')
    expect(typeof body.createdAt).toBe('string')
  })

  it('UC-I2: returns 404 for a missing file', async () => {
    await supertest(httpServer)
      .get('/v1/internal/files/00000000-0000-0000-0000-000000000000')
      .expect(404)
  })
})
