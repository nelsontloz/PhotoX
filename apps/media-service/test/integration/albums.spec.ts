import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'

interface AlbumDto {
  id: string
  userId: string
  name: string
  description: string | null
  assetCount: number
  createdAt: string
  updatedAt: string
}

interface AlbumListResponse {
  items: AlbumDto[]
  total: number
}

interface AssetListResponse {
  items: { id: string }[]
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

async function createAlbum(userId: string, name: string, description?: string): Promise<AlbumDto> {
  const res = await supertest(httpServer)
    .post('/v1/albums')
    .send({ userId, name, description })
    .expect(201)
  return res.body as AlbumDto
}

describe('POST /v1/albums', () => {
  it('creates album with minimal body', async () => {
    const userId = mintUserId()
    const body = await createAlbum(userId, 'Summer 2026')

    expect(typeof body.id).toBe('string')
    expect(body.userId).toBe(userId)
    expect(body.name).toBe('Summer 2026')
    expect(body.description).toBeNull()
    expect(body.assetCount).toBe(0)
    expect(typeof body.createdAt).toBe('string')
    expect(typeof body.updatedAt).toBe('string')
  })

  it('creates album with description', async () => {
    const userId = mintUserId()
    const body = await createAlbum(userId, 'Trip', 'A great trip')

    expect(body.name).toBe('Trip')
    expect(body.description).toBe('A great trip')
  })

  it('returns 400 for empty name', async () => {
    const userId = mintUserId()
    await supertest(httpServer).post('/v1/albums').send({ userId, name: '' }).expect(400)
  })

  it('returns 400 for missing name', async () => {
    const userId = mintUserId()
    await supertest(httpServer).post('/v1/albums').send({ userId }).expect(400)
  })

  it('returns 400 for name > 255 chars', async () => {
    const userId = mintUserId()
    await supertest(httpServer)
      .post('/v1/albums')
      .send({ userId, name: 'x'.repeat(256) })
      .expect(400)
  })

  it('returns 400 for description > 2000 chars', async () => {
    const userId = mintUserId()
    await supertest(httpServer)
      .post('/v1/albums')
      .send({ userId, name: 'ok', description: 'x'.repeat(2001) })
      .expect(400)
  })

  it('returns 400 for missing userId', async () => {
    await supertest(httpServer).post('/v1/albums').send({ name: 'Test' }).expect(400)
  })

  it('returns 400 for invalid UUID userId', async () => {
    await supertest(httpServer)
      .post('/v1/albums')
      .send({ userId: 'not-a-uuid', name: 'Test' })
      .expect(400)
  })
})

describe('GET /v1/albums', () => {
  it('lists albums for a user', async () => {
    const userId = mintUserId()
    await createAlbum(userId, 'A1')
    await createAlbum(userId, 'A2')

    const res = await supertest(httpServer).get('/v1/albums').query({ userId }).expect(200)
    const body = res.body as AlbumListResponse
    expect(body.items).toHaveLength(2)
    expect(body.total).toBe(2)
  })

  it('paginates albums', async () => {
    const userId = mintUserId()
    await createAlbum(userId, 'P1')
    await createAlbum(userId, 'P2')
    await createAlbum(userId, 'P3')

    const p1 = await supertest(httpServer)
      .get('/v1/albums')
      .query({ userId, limit: 2, offset: 0 })
      .expect(200)

    const body1 = p1.body as AlbumListResponse
    expect(body1.items).toHaveLength(2)
    expect(body1.total).toBe(3)

    const p2 = await supertest(httpServer)
      .get('/v1/albums')
      .query({ userId, limit: 2, offset: 2 })
      .expect(200)

    const body2 = p2.body as AlbumListResponse
    expect(body2.items).toHaveLength(1)
    expect(body2.total).toBe(3)
  })

  it('returns empty list for user with no albums', async () => {
    const userId = mintUserId()
    const res = await supertest(httpServer).get('/v1/albums').query({ userId }).expect(200)
    const body = res.body as AlbumListResponse
    expect(body.items).toHaveLength(0)
    expect(body.total).toBe(0)
  })
})

describe('GET /v1/albums/:id', () => {
  it('returns album by id', async () => {
    const userId = mintUserId()
    const album = await createAlbum(userId, 'Get Me')

    const res = await supertest(httpServer)
      .get(`/v1/albums/${album.id}`)
      .query({ userId })
      .expect(200)

    const body = res.body as AlbumDto
    expect(body.id).toBe(album.id)
    expect(body.name).toBe('Get Me')
  })

  it('returns 404 for non-existent id', async () => {
    const userId = mintUserId()
    await supertest(httpServer)
      .get('/v1/albums/00000000-0000-0000-0000-000000000000')
      .query({ userId })
      .expect(404)
  })
})

describe('PATCH /v1/albums/:id', () => {
  it('updates album name', async () => {
    const userId = mintUserId()
    const album = await createAlbum(userId, 'Old Name')

    const res = await supertest(httpServer)
      .patch(`/v1/albums/${album.id}`)
      .send({ userId, name: 'New Name' })
      .expect(200)

    const body = res.body as AlbumDto
    expect(body.name).toBe('New Name')
  })

  it('updates album description', async () => {
    const userId = mintUserId()
    const album = await createAlbum(userId, 'Desc Album')

    const res = await supertest(httpServer)
      .patch(`/v1/albums/${album.id}`)
      .send({ userId, description: 'new desc' })
      .expect(200)

    const body = res.body as AlbumDto
    expect(body.description).toBe('new desc')
  })
})

describe('DELETE /v1/albums/:id', () => {
  it('deletes album — 204 then 404 on get', async () => {
    const userId = mintUserId()
    const album = await createAlbum(userId, 'Delete Me')

    await supertest(httpServer).delete(`/v1/albums/${album.id}`).query({ userId }).expect(204)

    await supertest(httpServer).get(`/v1/albums/${album.id}`).query({ userId }).expect(404)
  })

  it('returns 404 for non-existent album', async () => {
    const userId = mintUserId()
    await supertest(httpServer)
      .delete('/v1/albums/00000000-0000-0000-0000-000000000000')
      .query({ userId })
      .expect(404)
  })
})

describe('POST /v1/albums/:id/assets', () => {
  it('adds assets to album', async () => {
    const userId = mintUserId()
    const album = await createAlbum(userId, 'With Assets')
    const asset = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .post(`/v1/albums/${album.id}/assets`)
      .send({ userId, assetIds: [asset.id] })
      .expect(201)

    const body = res.body as { added: number }
    expect(body.added).toBe(1)
  })

  it('returns 404 for non-existent album', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post('/v1/albums/00000000-0000-0000-0000-000000000000/assets')
      .send({ userId, assetIds: [asset.id] })
      .expect(404)
  })

  it('returns 404 for non-existent asset', async () => {
    const userId = mintUserId()
    const album = await createAlbum(userId, 'No Assets Here')
    const fakeAssetId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'

    await supertest(httpServer)
      .post(`/v1/albums/${album.id}/assets`)
      .send({ userId, assetIds: [fakeAssetId] })
      .expect(404)
  })

  it("returns 404 when adding another user's asset", async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const album = await createAlbum(userA, 'User A Album')
    const asset = await createAssetForUser(httpServer, userB)

    await supertest(httpServer)
      .post(`/v1/albums/${album.id}/assets`)
      .send({ userId: userA, assetIds: [asset.id] })
      .expect(404)
  })
})

describe('DELETE /v1/albums/:id/assets/:assetId', () => {
  it('removes asset from album — 204', async () => {
    const userId = mintUserId()
    const album = await createAlbum(userId, 'Remove Asset')
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/albums/${album.id}/assets`)
      .send({ userId, assetIds: [asset.id] })
      .expect(201)

    await supertest(httpServer)
      .delete(`/v1/albums/${album.id}/assets/${asset.id}`)
      .query({ userId })
      .expect(204)
  })
})

describe('GET /v1/albums/:id/assets', () => {
  it('lists assets in album', async () => {
    const userId = mintUserId()
    const album = await createAlbum(userId, 'List Assets')
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/albums/${album.id}/assets`)
      .send({ userId, assetIds: [asset.id] })
      .expect(201)

    const res = await supertest(httpServer)
      .get(`/v1/albums/${album.id}/assets`)
      .query({ userId })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.items).toHaveLength(1)
    expect(body.items[0]!.id).toBe(asset.id)
    expect(body.total).toBe(1)
  })

  it('returns empty list for album with no assets', async () => {
    const userId = mintUserId()
    const album = await createAlbum(userId, 'Empty Album')

    const res = await supertest(httpServer)
      .get(`/v1/albums/${album.id}/assets`)
      .query({ userId })
      .expect(200)

    const body = res.body as AssetListResponse
    expect(body.items).toHaveLength(0)
    expect(body.total).toBe(0)
  })
})

describe('Cross-user isolation', () => {
  it("GET returns 404 for another user's album", async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const album = await createAlbum(userA, 'Private')

    await supertest(httpServer).get(`/v1/albums/${album.id}`).query({ userId: userB }).expect(404)
  })

  it("PATCH returns 404 for another user's album", async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const album = await createAlbum(userA, 'No Touch')

    await supertest(httpServer)
      .patch(`/v1/albums/${album.id}`)
      .send({ userId: userB, name: 'Hacked' })
      .expect(404)
  })

  it("DELETE returns 404 for another user's album", async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const album = await createAlbum(userA, 'No Delete')

    await supertest(httpServer)
      .delete(`/v1/albums/${album.id}`)
      .query({ userId: userB })
      .expect(404)
  })

  it('POST assets returns 404 when another user tries to add to their album', async () => {
    const userA = mintUserId()
    const userB = mintUserId()
    const album = await createAlbum(userA, 'No Add')
    const asset = await createAssetForUser(httpServer, userB)

    await supertest(httpServer)
      .post(`/v1/albums/${album.id}/assets`)
      .send({ userId: userB, assetIds: [asset.id] })
      .expect(404)
  })
})
