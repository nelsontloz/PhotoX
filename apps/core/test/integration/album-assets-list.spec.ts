import request from 'supertest'
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedThumbnail,
  seedUser,
} from './helpers'
import type { ApiTestApp } from './helpers'

interface AlbumAssetsItem {
  id: string
  kind: string
  thumbnails?: { size: string; fileId: string }[]
  uploadedAt: string
  sizeBytes: number | null
  width: number | null
  height: number | null
  transcodeStatus: string | null
  transcodeFileId: string | null
}

interface AlbumAssetsBody {
  items: AlbumAssetsItem[]
  total: number
}

describe('album assets list', () => {
  let t: ApiTestApp

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null })
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(t)
  })

  beforeEach(async () => {
    await resetDb(t)
  })

  async function seedUserWithToken(): Promise<{ id: string; token: string }> {
    const user = await seedUser(t)
    return { id: user.id, token: t.signToken({ id: user.id, email: user.email, role: user.role }) }
  }

  async function createAlbum(token: string, name = 'Trip'): Promise<string> {
    const res = await request(apiServer(t))
      .post('/api/v1/albums')
      .set(t.authHeader(token))
      .send({ name })
    expect(res.status).toBe(201)
    return (res.body as { id: string }).id
  }

  async function addAsset(token: string, albumId: string, assetId: string): Promise<void> {
    const res = await request(apiServer(t))
      .post(`/api/v1/albums/${albumId}/assets`)
      .set(t.authHeader(token))
      .send({ assetIds: [assetId] })
    expect(res.status).toBe(201)
  }

  async function listAlbumAssets(
    token: string,
    albumId: string,
    query?: { limit?: number; offset?: number },
  ): Promise<AlbumAssetsBody> {
    const req = request(apiServer(t))
      .get(`/api/v1/albums/${albumId}/assets`)
      .set(t.authHeader(token))
    const res = await (query ? req.query(query) : req)
    expect(res.status).toBe(200)
    return res.body as AlbumAssetsBody
  }

  it('returns wire-shaped assets: embedded thumbnails, ISO dates and numeric columns', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id, {
      width: 1920,
      height: 1080,
      sizeBytes: 123456,
    })
    const thumb = await seedThumbnail(t, asset.id)
    const albumId = await createAlbum(token)
    await addAsset(token, albumId, asset.id)

    const body = await listAlbumAssets(token, albumId)

    expect(body.total).toBe(1)
    expect(body.items[0]?.thumbnails).toEqual(
      expect.arrayContaining([expect.objectContaining({ size: 'md', fileId: thumb.fileId })]),
    )
    expect(body.items[0]?.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(typeof body.items[0]?.sizeBytes).toBe('number')
    expect(typeof body.items[0]?.width).toBe('number')
    expect(typeof body.items[0]?.height).toBe('number')
    expect(body.items[0]?.width).toBe(1920)
    expect(body.items[0]?.height).toBe(1080)
  })

  it('embeds all thumbnail sizes ordered by createdAt ascending', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id)
    const sizes = ['sm', 'md', 'lg', 'xl']
    for (const [i, size] of sizes.entries()) {
      await seedThumbnail(t, asset.id, {
        size,
        createdAt: new Date(Date.UTC(2024, 0, 1, 0, 0, i)),
      })
    }
    const albumId = await createAlbum(token)
    await addAsset(token, albumId, asset.id)

    const body = await listAlbumAssets(token, albumId)

    expect(body.items[0]?.thumbnails?.map((thumb) => thumb.size)).toEqual(sizes)
  })

  it('paginates in addedAt DESC order with the full non-trashed total', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const file1 = await seedFile(t, userId)
    const file2 = await seedFile(t, userId)
    const file3 = await seedFile(t, userId)
    const a1 = await seedAsset(t, userId, file1.id)
    const a2 = await seedAsset(t, userId, file2.id)
    const a3 = await seedAsset(t, userId, file3.id)
    const albumId = await createAlbum(token)
    await addAsset(token, albumId, a1.id)
    await addAsset(token, albumId, a2.id)
    await addAsset(token, albumId, a3.id)
    await t.albumAssetRepo.update(
      { albumId, assetId: a1.id },
      { addedAt: new Date('2024-01-01T00:00:00.000Z') },
    )
    await t.albumAssetRepo.update(
      { albumId, assetId: a2.id },
      { addedAt: new Date('2024-01-01T00:01:00.000Z') },
    )
    await t.albumAssetRepo.update(
      { albumId, assetId: a3.id },
      { addedAt: new Date('2024-01-01T00:02:00.000Z') },
    )

    const page1 = await listAlbumAssets(token, albumId, { limit: 2, offset: 0 })
    expect(page1.total).toBe(3)
    expect(page1.items.map((item) => item.id)).toEqual([a3.id, a2.id])

    const page2 = await listAlbumAssets(token, albumId, { limit: 2, offset: 2 })
    expect(page2.total).toBe(3)
    expect(page2.items.map((item) => item.id)).toEqual([a1.id])

    const seen = new Set([...page1.items, ...page2.items].map((item) => item.id))
    expect(seen.size).toBe(3)
  })

  it('returns an empty page with zero total for an album without assets', async () => {
    const { token } = await seedUserWithToken()
    const albumId = await createAlbum(token)

    const body = await listAlbumAssets(token, albumId)

    expect(body).toEqual({ items: [], total: 0 })
  })

  it('excludes trashed assets from page and total, and restores them', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id)
    const albumId = await createAlbum(token)
    await addAsset(token, albumId, asset.id)

    const trash = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/trash`)
      .set(t.authHeader(token))
    expect(trash.status).toBe(204)
    expect(await listAlbumAssets(token, albumId)).toEqual({ items: [], total: 0 })

    const restore = await request(apiServer(t))
      .post(`/api/v1/assets/trashed/${asset.id}/restore`)
      .set(t.authHeader(token))
    expect(restore.status).toBe(204)
    const visible = await listAlbumAssets(token, albumId)
    expect(visible.total).toBe(1)
    expect(visible.items.map((item) => item.id)).toEqual([asset.id])
  })

  it('404s when another user reads the album assets', async () => {
    const owner = await seedUserWithToken()
    const other = await seedUserWithToken()
    const file = await seedFile(t, owner.id)
    const asset = await seedAsset(t, owner.id, file.id)
    const albumId = await createAlbum(owner.token)
    await addAsset(owner.token, albumId, asset.id)

    const res = await request(apiServer(t))
      .get(`/api/v1/albums/${albumId}/assets`)
      .set(t.authHeader(other.token))
    expect(res.status).toBe(404)
  })

  it('maps video transcode fields through the album path', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const file = await seedFile(t, userId, { mimeType: 'video/mp4', originalName: 'clip.mp4' })
    const transcode = await seedFile(t, userId, {
      mimeType: 'video/webm',
      originalName: 'clip.webm',
    })
    const asset = await seedAsset(t, userId, file.id, {
      kind: 'video',
      transcodeStatus: 'ready',
      transcodeFileId: transcode.id,
    })
    const albumId = await createAlbum(token)
    await addAsset(token, albumId, asset.id)

    const body = await listAlbumAssets(token, albumId)

    expect(body.items[0]?.kind).toBe('video')
    expect(body.items[0]?.transcodeStatus).toBe('ready')
    expect(body.items[0]?.transcodeFileId).toBe(transcode.id)
  })
})
