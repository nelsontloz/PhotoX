import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'
import type { AssetListResponse } from '@photox/shared-types'

interface ErrorBody {
  message: string
}

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('Cross-user isolation', () => {
  it("UC-U14: GET /v1/assets/:id returns 404 for another user's asset (not 403)", async () => {
    const owner = mintUserId()
    const other = mintUserId()
    const asset = await createAssetForUser(httpServer, owner)

    const res = await supertest(httpServer)
      .get(`/v1/assets/${asset.id}`)
      .query({ userId: other })
      .expect(404)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })

  it("UC-U14: PATCH /v1/assets/:id returns 404 for another user's asset", async () => {
    const owner = mintUserId()
    const other = mintUserId()
    const asset = await createAssetForUser(httpServer, owner)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${asset.id}`)
      .send({ userId: other, title: 'hacked' })
      .expect(404)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })

  it("UC-U14: POST /v1/assets/:id/trash returns 404 for another user's asset", async () => {
    const owner = mintUserId()
    const other = mintUserId()
    const asset = await createAssetForUser(httpServer, owner)

    const res = await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/trash`)
      .query({ userId: other })
      .expect(404)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })

  it("UC-U14: POST /v1/assets/:id/restore returns 404 for another user's asset", async () => {
    const owner = mintUserId()
    const other = mintUserId()
    const asset = await createAssetForUser(httpServer, owner)

    const res = await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/restore`)
      .query({ userId: other })
      .expect(404)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })

  it("UC-U15: asset list does not leak another user's assets", async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    await createAssetForUser(httpServer, userA)
    await createAssetForUser(httpServer, userA)
    await createAssetForUser(httpServer, userB)

    const res = await supertest(httpServer).get('/v1/assets').query({ userId: userA }).expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(2)
    for (const item of body.items) {
      expect(item.userId).toBe(userA)
    }
  })

  it('UC-U15: empty list for user with no assets', async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    await createAssetForUser(httpServer, userB)

    const res = await supertest(httpServer).get('/v1/assets').query({ userId: userA }).expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(0)
    expect(body.items).toHaveLength(0)
  })
})
