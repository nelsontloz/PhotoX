import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Asset } from '../../src/entities/asset.entity'
import type { Repository } from 'typeorm'
import type { AssetListResponse } from '@photox/shared-types'

interface ErrorBody {
  message: string | string[]
}

let app: INestApplication
let httpServer: Server
let assetRepo: Repository<Asset>

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
  assetRepo = app.get(getRepositoryToken(Asset))
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('GET /v1/assets', () => {
  it('UC-U3: returns empty library for a user with no assets', async () => {
    const userId = mintUserId()

    const res = await supertest(httpServer).get('/v1/assets').query({ userId }).expect(200)

    const body = res.body as AssetListResponse
    expect(body.items).toHaveLength(0)
    expect(body.total).toBe(0)
  })

  it('UC-U3: defaults to pagination of 20', async () => {
    const userId = mintUserId()
    await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer).get('/v1/assets').query({ userId }).expect(200)

    const body = res.body as AssetListResponse
    expect(body.limit).toBe(20)
    expect(body.offset).toBe(0)
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
  })

  it('UC-U4: filters by kind=photo', async () => {
    const userId = mintUserId()
    await createAssetForUser(httpServer, userId, { kind: 'photo' })
    await createAssetForUser(httpServer, userId, { kind: 'video' })

    const res = await supertest(httpServer)
      .get('/v1/assets?kind=photo')
      .query({ userId })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(1)
    expect(body.items[0]!.kind).toBe('photo')
  })

  it('UC-U4: filters by kind=video', async () => {
    const userId = mintUserId()
    await createAssetForUser(httpServer, userId, { kind: 'photo' })
    await createAssetForUser(httpServer, userId, { kind: 'video' })

    const res = await supertest(httpServer)
      .get('/v1/assets?kind=video')
      .query({ userId })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(1)
    expect(body.items[0]!.kind).toBe('video')
  })

  it('UC-U4: filters by favorite=true', async () => {
    const userId = mintUserId()
    const a = await createAssetForUser(httpServer, userId)
    await createAssetForUser(httpServer, userId)
    await assetRepo.update(a.id, { favorite: true })

    const res = await supertest(httpServer)
      .get('/v1/assets?favorite=true')
      .query({ userId })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(1)
    expect(body.items[0]!.id).toBe(a.id)
  })

  it('UC-U4: filters by metadataStatus', async () => {
    const userId = mintUserId()
    const a = await createAssetForUser(httpServer, userId)
    await createAssetForUser(httpServer, userId)
    await assetRepo.update(a.id, { metadataStatus: 'ready' })

    const res = await supertest(httpServer)
      .get('/v1/assets?metadataStatus=ready')
      .query({ userId })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(1)
    expect(body.items[0]!.id).toBe(a.id)
  })

  it('UC-U4: filters by mimeType prefix', async () => {
    const userId = mintUserId()
    const a = await createAssetForUser(httpServer, userId)
    const b = await createAssetForUser(httpServer, userId)
    await assetRepo.update(a.id, { mimeType: 'image/jpeg' })
    await assetRepo.update(b.id, { mimeType: 'video/mp4' })

    const res = await supertest(httpServer)
      .get('/v1/assets?mimeType=image/')
      .query({ userId })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(1)
    expect(body.items[0]!.id).toBe(a.id)
  })

  it('UC-U4: filters by date range (fromDate/toDate)', async () => {
    const userId = mintUserId()
    const a = await createAssetForUser(httpServer, userId, {
      takenAt: '2025-01-15T00:00:00.000Z',
    })
    await createAssetForUser(httpServer, userId, {
      takenAt: '2025-06-15T00:00:00.000Z',
    })

    const res = await supertest(httpServer)
      .get('/v1/assets?fromDate=2025-01-01T00:00:00.000Z&toDate=2025-04-01T00:00:00.000Z')
      .query({ userId })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(1)
    expect(body.items[0]!.id).toBe(a.id)
  })

  it('UC-U5: default isTrashed=false — trashed assets are hidden', async () => {
    const userId = mintUserId()
    const a = await createAssetForUser(httpServer, userId)
    const b = await createAssetForUser(httpServer, userId)
    await assetRepo.update(b.id, { isTrashed: true, trashedAt: new Date() })

    const res = await supertest(httpServer).get('/v1/assets').query({ userId }).expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(1)
    expect(body.items[0]!.id).toBe(a.id)
  })

  it('UC-U5: isTrashed=true returns only trashed assets', async () => {
    const userId = mintUserId()
    await createAssetForUser(httpServer, userId)
    const b = await createAssetForUser(httpServer, userId)
    await assetRepo.update(b.id, { isTrashed: true, trashedAt: new Date() })

    const res = await supertest(httpServer)
      .get('/v1/assets?isTrashed=true')
      .query({ userId })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(1)
    expect(body.items[0]!.id).toBe(b.id)
  })

  it('UC-U6: pagination — limit=1 returns one item, offset skips', async () => {
    const userId = mintUserId()
    await createAssetForUser(httpServer, userId)
    await createAssetForUser(httpServer, userId)
    await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .get('/v1/assets?limit=1&offset=1')
      .query({ userId })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.total).toBe(3)
    expect(body.limit).toBe(1)
    expect(body.offset).toBe(1)
    expect(body.items).toHaveLength(1)
  })

  it('UC-U6: pagination — limit=1 returns one item with limit=1', async () => {
    const userId = mintUserId()
    await createAssetForUser(httpServer, userId)
    await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer).get('/v1/assets?limit=1').query({ userId }).expect(200)

    const body = res.body as AssetListResponse
    expect(body.items).toHaveLength(1)
    expect(body.total).toBe(2)
  })

  it('UC-U6: pagination — limit=100 is accepted (upper boundary)', async () => {
    const userId = mintUserId()

    await supertest(httpServer).get('/v1/assets?limit=100').query({ userId }).expect(200)
  })

  it('UC-U6: pagination — offset past end returns empty items', async () => {
    const userId = mintUserId()
    await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .get('/v1/assets?offset=100')
      .query({ userId })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.items).toHaveLength(0)
    expect(body.total).toBe(1)
  })

  it('UC-U21: fromDate > toDate returns 200 with empty items', async () => {
    const userId = mintUserId()
    await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .get('/v1/assets?fromDate=2030-01-01T00:00:00.000Z&toDate=2020-01-01T00:00:00.000Z')
      .query({ userId })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.items).toHaveLength(0)
    expect(body.total).toBe(0)
  })

  it('UC-U25: limit < 1 returns 400', async () => {
    const userId = mintUserId()

    const res = await supertest(httpServer).get('/v1/assets?limit=0').query({ userId }).expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })

  it('UC-U25: limit > 100 returns 400', async () => {
    const userId = mintUserId()

    const res = await supertest(httpServer)
      .get('/v1/assets?limit=101')
      .query({ userId })
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })

  it('UC-U25: offset < 0 returns 400', async () => {
    const userId = mintUserId()

    const res = await supertest(httpServer)
      .get('/v1/assets?offset=-1')
      .query({ userId })
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })

  it('UC-U26: metadataStatus filter only accepts pending/ready/failed', async () => {
    const userId = mintUserId()

    const res = await supertest(httpServer)
      .get('/v1/assets?metadataStatus=invalid')
      .query({ userId })
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })
})
