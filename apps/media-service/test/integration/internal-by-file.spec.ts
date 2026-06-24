import { type INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'
import type { Asset } from '@photox/shared-types'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('GET /v1/assets/by-file/:fileId', () => {
  it('UC-I3: returns the asset for a known fileId', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer).get(`/v1/assets/by-file/${created.fileId}`).expect(200)

    const body = res.body as Asset
    expect(body.id).toBe(created.id)
    expect(body.fileId).toBe(created.fileId)
    expect(body.userId).toBe(userId)
  })

  it('UC-I4: returns 404 for an unknown fileId', async () => {
    const fakeFileId = randomUUID()

    await supertest(httpServer).get(`/v1/assets/by-file/${fakeFileId}`).expect(404)
  })

  it('UC-I5: trashed asset is still returned with isTrashed=true', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer).post(`/v1/assets/${created.id}/trash`).query({ userId }).expect(204)

    const res = await supertest(httpServer).get(`/v1/assets/by-file/${created.fileId}`).expect(200)

    const body = res.body as Asset
    expect(body.isTrashed).toBe(true)
    expect(body.trashedAt).not.toBeNull()
  })
})
