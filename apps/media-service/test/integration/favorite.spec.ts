import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'
import type { Asset, AssetListResponse } from '@photox/shared-types'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('PATCH /v1/assets/:id — favorite', () => {
  it('sets favorite to true', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .send({ userId, favorite: true })
      .expect(200)

    const body = res.body as Asset
    expect(body.favorite).toBe(true)

    const get = await supertest(httpServer)
      .get(`/v1/assets/${created.id}`)
      .query({ userId })
      .expect(200)

    expect((get.body as Asset).favorite).toBe(true)
  })

  it('sets favorite back to false', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .send({ userId, favorite: true })
      .expect(200)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .send({ userId, favorite: false })
      .expect(200)

    const body = res.body as Asset
    expect(body.favorite).toBe(false)

    const get = await supertest(httpServer)
      .get(`/v1/assets/${created.id}`)
      .query({ userId })
      .expect(200)

    expect((get.body as Asset).favorite).toBe(false)
  })

  it('returns 404 when another user tries to favorite the asset', async () => {
    const owner = mintUserId()
    const other = mintUserId()
    const created = await createAssetForUser(httpServer, owner)

    await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .send({ userId: other, favorite: true })
      .expect(404)
  })
})

describe('GET /v1/assets?favorite=', () => {
  it('filters by favorite=true', async () => {
    const userId = mintUserId()
    const a = await createAssetForUser(httpServer, userId)
    const b = await createAssetForUser(httpServer, userId)
    await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${a.id}`)
      .send({ userId, favorite: true })
      .expect(200)

    await supertest(httpServer)
      .patch(`/v1/assets/${b.id}`)
      .send({ userId, favorite: true })
      .expect(200)

    const res = await supertest(httpServer)
      .get('/v1/assets')
      .query({ userId, favorite: 'true' })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(2)
    expect(body.items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('returns all assets when favorite filter is omitted', async () => {
    const userId = mintUserId()
    const a = await createAssetForUser(httpServer, userId)
    const b = await createAssetForUser(httpServer, userId)
    const c = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${a.id}`)
      .send({ userId, favorite: true })
      .expect(200)

    await supertest(httpServer)
      .patch(`/v1/assets/${c.id}`)
      .send({ userId, favorite: true })
      .expect(200)

    const res = await supertest(httpServer).get('/v1/assets').query({ userId }).expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(3)
    expect(body.items.map((i) => i.id).sort()).toEqual([a.id, b.id, c.id].sort())
  })
})
