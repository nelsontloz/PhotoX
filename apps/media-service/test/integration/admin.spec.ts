import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'

interface AdminAssetCountsResponse {
  photos: { processing: number; metadata: number; thumbnails: number; encoding: number }
  videos: { processing: number; metadata: number; thumbnails: number; encoding: number }
}

interface AdminReprocessItem {
  id: string
  userId: string
  fileId: string
}

interface AdminReprocessResponse {
  items: AdminReprocessItem[]
  total: number
}

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

async function setStatusFailed(assetId: string): Promise<void> {
  await supertest(httpServer)
    .patch(`/v1/assets/${assetId}/metadata`)
    .send({ status: 'failed' })
    .expect(200)
}

describe('GET /v1/admin/users/asset-stats', () => {
  it('counts assets per user', async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    await createAssetForUser(httpServer, userA)
    await createAssetForUser(httpServer, userA)
    await createAssetForUser(httpServer, userA)
    await createAssetForUser(httpServer, userB)

    const res = await supertest(httpServer)
      .get('/v1/admin/users/asset-stats')
      .query({ userIds: `${userA},${userB}` })
      .expect(200)

    const body = res.body as Record<string, number>
    expect(body[userA]).toBe(3)
    expect(body[userB]).toBe(1)
  })

  it('returns empty object for no userIds', async () => {
    const res = await supertest(httpServer).get('/v1/admin/users/asset-stats').expect(200)

    expect(res.body).toEqual({})
  })

  it('excludes user with no assets from result', async () => {
    const userA = mintUserId()
    const unknown = mintUserId()
    await createAssetForUser(httpServer, userA)

    const res = await supertest(httpServer)
      .get('/v1/admin/users/asset-stats')
      .query({ userIds: `${userA},${unknown}` })
      .expect(200)

    const body = res.body as Record<string, number>
    expect(body[userA]).toBe(1)
    expect(body[unknown]).toBeUndefined()
  })
})

describe('GET /v1/admin/assets/counts', () => {
  it('counts failed metadata statuses by kind', async () => {
    const userId = mintUserId()
    const photo1 = await createAssetForUser(httpServer, userId, { kind: 'photo' })
    const photo2 = await createAssetForUser(httpServer, userId, { kind: 'photo' })
    await setStatusFailed(photo1.id)
    await setStatusFailed(photo2.id)

    const video = await createAssetForUser(httpServer, userId, { kind: 'video' })
    await setStatusFailed(video.id)

    const res = await supertest(httpServer).get('/v1/admin/assets/counts').expect(200)

    const body = res.body as AdminAssetCountsResponse
    expect(body.photos.metadata).toBeGreaterThanOrEqual(2)
    expect(body.videos.metadata).toBeGreaterThanOrEqual(1)
  })

  it('counts thumbnail failures', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${asset.id}/metadata`)
      .send({ thumbnailStatus: 'failed' })
      .expect(200)

    const res = await supertest(httpServer).get('/v1/admin/assets/counts').expect(200)
    const body = res.body as AdminAssetCountsResponse
    expect(body.photos.thumbnails).toBeGreaterThanOrEqual(1)
  })

  it('counts encoding failures', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId, { kind: 'video' })

    await supertest(httpServer)
      .patch(`/v1/assets/${asset.id}/metadata`)
      .send({ transcodeStatus: 'failed' })
      .expect(200)

    const res = await supertest(httpServer).get('/v1/admin/assets/counts').expect(200)
    const body = res.body as AdminAssetCountsResponse
    expect(body.videos.encoding).toBeGreaterThanOrEqual(1)
  })
})

describe('GET /v1/admin/assets', () => {
  it('lists assets for reprocessing', async () => {
    const userId = mintUserId()
    await createAssetForUser(httpServer, userId, { kind: 'photo' })
    await createAssetForUser(httpServer, userId, { kind: 'photo' })

    const res = await supertest(httpServer)
      .get('/v1/admin/assets')
      .query({ kind: 'photo' })
      .expect(200)

    const body = res.body as AdminReprocessResponse
    expect(body.total).toBeGreaterThanOrEqual(2)
    expect(body.items.length).toBeGreaterThanOrEqual(2)
    for (const item of body.items) {
      expect(typeof item.id).toBe('string')
      expect(typeof item.userId).toBe('string')
      expect(typeof item.fileId).toBe('string')
    }
  })

  it('filters by kind — photo only', async () => {
    const userId = mintUserId()
    await createAssetForUser(httpServer, userId, { kind: 'photo' })
    await createAssetForUser(httpServer, userId, { kind: 'video' })

    const photoRes = await supertest(httpServer)
      .get('/v1/admin/assets')
      .query({ kind: 'photo' })
      .expect(200)

    const photoBody = photoRes.body as AdminReprocessResponse
    expect(photoBody.total).toBeGreaterThanOrEqual(1)

    const videoRes = await supertest(httpServer)
      .get('/v1/admin/assets')
      .query({ kind: 'video' })
      .expect(200)

    const videoBody = videoRes.body as AdminReprocessResponse
    expect(videoBody.total).toBeGreaterThanOrEqual(1)
  })
})
