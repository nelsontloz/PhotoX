import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'
import type { AssetShareDto, ShareListResponse, PublicShareResponse } from '@photox/shared-types'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('POST /v1/shares', () => {
  it('creates a share for a valid asset', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .post('/v1/shares')
      .send({ userId, assetId: asset.id })
      .expect(201)

    const body = res.body as AssetShareDto
    expect(body.token).toBeTypeOf('string')
    expect(body.token.length).toBeGreaterThan(0)
    expect(body.assetId).toBe(asset.id)
    expect(body.userId).toBe(userId)
  })

  it('deduplicates shares for the same asset+user', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    const first = await supertest(httpServer)
      .post('/v1/shares')
      .send({ userId, assetId: asset.id })
      .expect(201)

    const second = await supertest(httpServer)
      .post('/v1/shares')
      .send({ userId, assetId: asset.id })
      .expect(201)

    expect((second.body as AssetShareDto).token).toBe((first.body as AssetShareDto).token)
  })

  it('returns 404 when asset does not belong to the user', async () => {
    const owner = mintUserId()
    const other = mintUserId()
    const asset = await createAssetForUser(httpServer, owner)

    await supertest(httpServer)
      .post('/v1/shares')
      .send({ userId: other, assetId: asset.id })
      .expect(404)
  })

  it('returns 404 when sharing a trashed asset', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer).post(`/v1/assets/${asset.id}/trash`).query({ userId }).expect(204)

    await supertest(httpServer).post('/v1/shares').send({ userId, assetId: asset.id }).expect(404)
  })
})

describe('GET /v1/shares', () => {
  it('lists shares for the user', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)
    const created = await supertest(httpServer)
      .post('/v1/shares')
      .send({ userId, assetId: asset.id })
      .expect(201)

    const res = await supertest(httpServer).get('/v1/shares').query({ userId }).expect(200)

    const body = res.body as ShareListResponse
    expect(body.items.length).toBeGreaterThanOrEqual(1)
    expect(body.items.some((s) => s.id === (created.body as AssetShareDto).id)).toBe(true)
  })

  it('returns empty list for a different user', async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const asset = await createAssetForUser(httpServer, userA)

    await supertest(httpServer)
      .post('/v1/shares')
      .send({ userId: userA, assetId: asset.id })
      .expect(201)

    const res = await supertest(httpServer).get('/v1/shares').query({ userId: userB }).expect(200)

    expect((res.body as ShareListResponse).items).toHaveLength(0)
  })
})

describe('DELETE /v1/shares/:id', () => {
  it('revokes a share', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)
    const created = await supertest(httpServer)
      .post('/v1/shares')
      .send({ userId, assetId: asset.id })
      .expect(201)

    await supertest(httpServer)
      .delete(`/v1/shares/${(created.body as AssetShareDto).id}`)
      .query({ userId })
      .expect(204)
  })

  it('returns 404 when another user tries to revoke', async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const asset = await createAssetForUser(httpServer, userA)
    const created = await supertest(httpServer)
      .post('/v1/shares')
      .send({ userId: userA, assetId: asset.id })
      .expect(201)

    await supertest(httpServer)
      .delete(`/v1/shares/${(created.body as AssetShareDto).id}`)
      .query({ userId: userB })
      .expect(404)
  })
})

describe('GET /v1/shares/public/:token', () => {
  it('returns share and asset for a valid token', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)
    const created = await supertest(httpServer)
      .post('/v1/shares')
      .send({ userId, assetId: asset.id })
      .expect(201)

    const token = (created.body as AssetShareDto).token

    const res = await supertest(httpServer).get(`/v1/shares/public/${token}`).expect(200)

    const body = res.body as PublicShareResponse
    expect(body.share.token).toBe(token)
    expect(body.asset.id).toBe(asset.id)
  })

  it('returns 404 for unknown token', async () => {
    await supertest(httpServer).get('/v1/shares/public/nonexistent-token').expect(404)
  })

  it('returns 404 after the share is revoked', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)
    const created = await supertest(httpServer)
      .post('/v1/shares')
      .send({ userId, assetId: asset.id })
      .expect(201)

    const token = (created.body as AssetShareDto).token

    await supertest(httpServer)
      .delete(`/v1/shares/${(created.body as AssetShareDto).id}`)
      .query({ userId })
      .expect(204)

    await supertest(httpServer).get(`/v1/shares/public/${token}`).expect(404)
  })

  it('returns 404 for a trashed asset', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)
    const created = await supertest(httpServer)
      .post('/v1/shares')
      .send({ userId, assetId: asset.id })
      .expect(201)

    const token = (created.body as AssetShareDto).token

    await supertest(httpServer).post(`/v1/assets/${asset.id}/trash`).query({ userId }).expect(204)

    await supertest(httpServer).get(`/v1/shares/public/${token}`).expect(404)
  })
})
