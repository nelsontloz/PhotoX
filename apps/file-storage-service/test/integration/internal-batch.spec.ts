import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, uploadForUser } from './helpers'
import type { BatchFilesResponse } from '@photox/shared-types'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('POST /v1/files/batch', () => {
  it('UC-I3: resolves many files — items for found, missing for not found', async () => {
    const userId = mintUserId()
    const r1 = await uploadForUser(httpServer, userId, 'a.png', Buffer.from('a'), 'image/png')
    const r2 = await uploadForUser(httpServer, userId, 'b.png', Buffer.from('bb'), 'image/png')
    const r3 = await uploadForUser(httpServer, userId, 'c.png', Buffer.from('ccc'), 'image/png')
    const fakeId = '00000000-0000-0000-0000-000000000000'

    const res = await supertest(httpServer)
      .post('/v1/files/batch')
      .send({ fileIds: [r1.id, r2.id, fakeId, r3.id] })
      .expect(201)

    const body = res.body as BatchFilesResponse
    expect(body.items).toHaveLength(3)
    expect(body.missing).toEqual([fakeId])

    const returnedIds = body.items.map((f) => f.id).sort()
    const expectedIds = [r1.id, r2.id, r3.id].sort()
    expect(returnedIds).toEqual(expectedIds)
  })

  it('returns empty items and missing for empty input', async () => {
    const res = await supertest(httpServer)
      .post('/v1/files/batch')
      .send({ fileIds: [] })
      .expect(201)

    const body = res.body as BatchFilesResponse
    expect(body.items).toHaveLength(0)
    expect(body.missing).toHaveLength(0)
  })

  it('returns all as missing when none exist', async () => {
    const fakeId1 = '00000000-0000-0000-0000-000000000001'
    const fakeId2 = '00000000-0000-0000-0000-000000000002'

    const res = await supertest(httpServer)
      .post('/v1/files/batch')
      .send({ fileIds: [fakeId1, fakeId2] })
      .expect(201)

    const body = res.body as BatchFilesResponse
    expect(body.items).toHaveLength(0)
    expect(body.missing).toEqual([fakeId1, fakeId2])
  })
})
