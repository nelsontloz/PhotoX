import { createHash, randomUUID } from 'node:crypto'
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

interface ShareBody {
  id: string
  kind: string
  userId: string
  token: string
  albumId?: string
  albumName?: string
  albumAssetCount?: number
  albumCoverThumbFileId?: string | null
  assetId?: string
  assetKind?: string | null
}

interface PublicAsset {
  id: string
  userId: string
  kind: string
  fileId: string
  transcodeFileId: string | null
  title: string | null
  originalName: string | null
  mimeType: string | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  takenAt: string | null
}

describe('album shares', () => {
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

  async function createAlbum(userId: string, name = 'Trip', description: string | null = null) {
    const album = t.albumRepo.create({ userId, name, description })
    return t.albumRepo.save(album)
  }

  async function addMember(albumId: string, assetId: string, addedAt?: Date): Promise<void> {
    await t.albumAssetRepo.save(t.albumAssetRepo.create({ albumId, assetId }))
    if (addedAt) {
      await t.albumAssetRepo.update({ albumId, assetId }, { addedAt })
    }
  }

  async function createShare(token: string, body: Record<string, unknown>) {
    return request(apiServer(t)).post('/api/v1/shares').set(t.authHeader(token)).send(body)
  }

  it('keeps the shares schema guardrails (exactly-one check + targeted unique indexes)', async () => {
    const constraints = await t.dataSource.query<{ conname: string }[]>(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'shares'::regclass AND contype = 'c'",
    )
    expect(constraints.map((c) => c.conname)).toContain('CHK_shares_exactly_one_target')

    const indexes = await t.dataSource.query<{ indexdef: string }[]>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'shares'",
    )
    const defs = indexes.map((i) => i.indexdef)
    expect(defs.some((def) => def.includes('"assetId" IS NOT NULL'))).toBe(true)
    expect(defs.some((def) => def.includes('"albumId" IS NOT NULL'))).toBe(true)
  })

  it('creates an album share with non-trashed count/cover and dedupes the same album', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const album = await createAlbum(userId)
    const file1 = await seedFile(t, userId)
    const file2 = await seedFile(t, userId)
    const member = await seedAsset(t, userId, file1.id)
    const trashed = await seedAsset(t, userId, file2.id, { isTrashed: true })
    const thumb = await seedThumbnail(t, member.id, { size: 'sm' })
    await addMember(album.id, member.id)
    await addMember(album.id, trashed.id)

    const first = await createShare(token, { albumId: album.id })
    expect(first.status).toBe(201)
    const firstBody = first.body as ShareBody
    expect(firstBody.kind).toBe('album')
    expect(firstBody.userId).toBe(userId)
    expect(firstBody.albumId).toBe(album.id)
    expect(firstBody.albumName).toBe('Trip')
    expect(firstBody.albumAssetCount).toBe(1)
    expect(firstBody.albumCoverThumbFileId).toBe(thumb.fileId)
    expect(typeof firstBody.token).toBe('string')

    const second = await createShare(token, { albumId: album.id })
    expect(second.status).toBe(201)
    const secondBody = second.body as ShareBody
    expect(secondBody.id).toBe(firstBody.id)
    expect(secondBody.token).toBe(firstBody.token)
    expect(await t.shareRepo.count({ where: { albumId: album.id } })).toBe(1)
  })

  it('rejects missing or both targets with 400', async () => {
    const { token } = await seedUserWithToken()
    const neither = await createShare(token, {})
    expect(neither.status).toBe(400)
    const both = await createShare(token, { assetId: randomUUID(), albumId: randomUUID() })
    expect(both.status).toBe(400)
  })

  it('404s cross-user create and revoke', async () => {
    const owner = await seedUserWithToken()
    const other = await seedUserWithToken()
    const album = await createAlbum(owner.id)

    const crossCreate = await createShare(other.token, { albumId: album.id })
    expect(crossCreate.status).toBe(404)

    const created = await createShare(owner.token, { albumId: album.id })
    const share = created.body as ShareBody
    const crossRevoke = await request(apiServer(t))
      .delete(`/api/v1/shares/${share.id}`)
      .set(t.authHeader(other.token))
    expect(crossRevoke.status).toBe(404)
  })

  it('lists asset and album shares together, isolated per user', async () => {
    const a = await seedUserWithToken()
    const b = await seedUserWithToken()
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const album = await createAlbum(a.id)
    await createShare(a.token, { assetId: asset.id })
    await createShare(a.token, { albumId: album.id })

    const list = await request(apiServer(t)).get('/api/v1/shares').set(t.authHeader(a.token))
    expect(list.status).toBe(200)
    const items = (list.body as { items: ShareBody[] }).items
    expect(items).toHaveLength(2)
    const kinds = items.map((item) => item.kind)
    expect(kinds).toContain('asset')
    expect(kinds).toContain('album')
    const albumItem = items.find((item) => item.kind === 'album')
    expect(albumItem?.albumId).toBe(album.id)
    expect(albumItem?.albumAssetCount).toBe(0)

    const otherList = await request(apiServer(t)).get('/api/v1/shares').set(t.authHeader(b.token))
    expect((otherList.body as { items: unknown[] }).items).toHaveLength(0)
  })

  it('revokes an album share (204) and then 404s the public route', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const album = await createAlbum(userId)
    const created = await createShare(token, { albumId: album.id })
    const share = created.body as ShareBody

    const revoked = await request(apiServer(t))
      .delete(`/api/v1/shares/${share.id}`)
      .set(t.authHeader(token))
    expect(revoked.status).toBe(204)

    const pub = await request(apiServer(t)).get(`/api/share/${share.token}`)
    expect(pub.status).toBe(404)
  })

  it('resolves a public album share with kind, meta and non-trashed count', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const album = await createAlbum(userId, 'Holidays', 'Summer photos')
    const file = await seedFile(t, userId)
    const trashedFile = await seedFile(t, userId)
    const member = await seedAsset(t, userId, file.id)
    const trashed = await seedAsset(t, userId, trashedFile.id, { isTrashed: true })
    await addMember(album.id, member.id)
    await addMember(album.id, trashed.id)

    const created = await createShare(token, { albumId: album.id })
    const share = created.body as ShareBody
    const res = await request(apiServer(t)).get(`/api/share/${share.token}`)
    expect(res.status).toBe(200)
    const body = res.body as {
      kind: string
      share: ShareBody
      album: { id: string; name: string; description: string | null; assetCount: number }
    }
    expect(body.kind).toBe('album')
    expect(body.share.kind).toBe('album')
    expect(body.album).toEqual({
      id: album.id,
      name: 'Holidays',
      description: 'Summer photos',
      assetCount: 1,
    })

    const stream = await request(apiServer(t)).get(`/api/share/${share.token}/stream`)
    expect(stream.status).toBe(404)
  })

  it('lists album members in addedAt DESC order via the public route', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const album = await createAlbum(userId)
    const a1 = await seedAsset(t, userId, (await seedFile(t, userId)).id)
    const a2 = await seedAsset(t, userId, (await seedFile(t, userId)).id)
    const a3 = await seedAsset(t, userId, (await seedFile(t, userId)).id)
    await addMember(album.id, a1.id, new Date('2024-01-01T00:00:00.000Z'))
    await addMember(album.id, a2.id, new Date('2024-01-01T00:01:00.000Z'))
    await addMember(album.id, a3.id, new Date('2024-01-01T00:02:00.000Z'))

    const created = await createShare(token, { albumId: album.id })
    const share = created.body as ShareBody
    const res = await request(apiServer(t)).get(`/api/share/${share.token}/assets`)
    expect(res.status).toBe(200)
    const items = (res.body as { items: PublicAsset[] }).items
    expect(items.map((item) => item.id)).toEqual([a3.id, a2.id, a1.id])
  })

  it('does not leak exif, gps or faces through the public album projection', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const album = await createAlbum(userId)
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id)
    await t.assetRepo.update(asset.id, {
      latitude: 48.8584,
      longitude: 2.2945,
      altitude: 35,
      cameraMake: 'Leica',
      cameraModel: 'M11',
      lensModel: 'Summicron',
      iso: 400,
      fNumber: 2,
      exposureTime: 0.008,
      focalLength: 35,
      metadata: { gps: { lat: 48.8584, lon: 2.2945 }, exif: { Make: 'Leica' } },
      faceCount: 2,
    })
    await addMember(album.id, asset.id)

    const created = await createShare(token, { albumId: album.id })
    const share = created.body as ShareBody
    const res = await request(apiServer(t)).get(`/api/share/${share.token}/assets`)
    expect(res.status).toBe(200)
    const item = (res.body as { items: Record<string, unknown>[] }).items[0]!
    const forbidden = [
      'latitude',
      'longitude',
      'altitude',
      'cameraMake',
      'cameraModel',
      'lensModel',
      'iso',
      'fNumber',
      'exposureTime',
      'focalLength',
      'metadata',
      'faceCount',
      'faces',
      'gps',
      'exif',
    ]
    for (const key of forbidden) {
      expect(item).not.toHaveProperty(key)
    }
    expect(JSON.stringify(res.body)).not.toContain('48.8584')
    expect(JSON.stringify(res.body)).not.toContain('Summicron')
  })

  it('excludes trashed members from /assets and 404s their stream', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const album = await createAlbum(userId)
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id)
    await addMember(album.id, asset.id)

    const created = await createShare(token, { albumId: album.id })
    const share = created.body as ShareBody

    const trashed = await request(apiServer(t))
      .post(`/api/v1/assets/${asset.id}/trash`)
      .set(t.authHeader(token))
    expect(trashed.status).toBe(204)

    const list = await request(apiServer(t)).get(`/api/share/${share.token}/assets`)
    expect(list.status).toBe(200)
    expect((list.body as { items: unknown[] }).items).toHaveLength(0)

    const stream = await request(apiServer(t)).get(
      `/api/share/${share.token}/assets/${asset.id}/stream`,
    )
    expect(stream.status).toBe(404)

    const pub = await request(apiServer(t)).get(`/api/share/${share.token}`)
    expect((pub.body as { album: { assetCount: number } }).album.assetCount).toBe(0)
  })

  it('reflects membership add and remove', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const album = await createAlbum(userId)
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id)
    const created = await createShare(token, { albumId: album.id })
    const share = created.body as ShareBody

    const empty = await request(apiServer(t)).get(`/api/share/${share.token}/assets`)
    expect((empty.body as { items: unknown[] }).items).toHaveLength(0)

    await addMember(album.id, asset.id)
    const added = await request(apiServer(t)).get(`/api/share/${share.token}/assets`)
    expect((added.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([asset.id])

    const resolved = await request(apiServer(t)).get(`/api/share/${share.token}`)
    expect((resolved.body as { album: { assetCount: number } }).album.assetCount).toBe(1)

    await t.albumAssetRepo.delete({ albumId: album.id, assetId: asset.id })
    const removed = await request(apiServer(t)).get(`/api/share/${share.token}/assets`)
    expect((removed.body as { items: unknown[] }).items).toHaveLength(0)
  })

  it('serves Range 206 and ETag 304 on a member stream', async () => {
    const bytes = Buffer.from('0123456789')
    const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`
    const { id: userId, token } = await seedUserWithToken()
    const album = await createAlbum(userId)
    const file = await seedFile(t, userId, { bytes, mimeType: 'application/octet-stream' })
    const asset = await seedAsset(t, userId, file.id)
    await addMember(album.id, asset.id)
    const created = await createShare(token, { albumId: album.id })
    const share = created.body as ShareBody

    const ranged = await request(apiServer(t))
      .get(`/api/share/${share.token}/assets/${asset.id}/stream`)
      .set('Range', 'bytes=2-4')
    expect(ranged.status).toBe(206)
    expect(ranged.headers['content-range']).toBe('bytes 2-4/10')
    expect(ranged.headers.etag).toBe(etag)
    expect((ranged.body as Buffer).toString('utf8')).toBe('234')

    const full = await request(apiServer(t)).get(
      `/api/share/${share.token}/assets/${asset.id}/stream`,
    )
    expect(full.status).toBe(200)
    expect(full.headers.etag).toBe(etag)

    const cached = await request(apiServer(t))
      .get(`/api/share/${share.token}/assets/${asset.id}/stream`)
      .set('If-None-Match', etag)
    expect(cached.status).toBe(304)
  })

  it('404s a non-member asset on the member stream route', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const album = await createAlbum(userId)
    const memberFile = await seedFile(t, userId)
    const member = await seedAsset(t, userId, memberFile.id)
    await addMember(album.id, member.id)
    const outsider = await seedAsset(t, userId, (await seedFile(t, userId)).id)

    const created = await createShare(token, { albumId: album.id })
    const share = created.body as ShareBody

    const res = await request(apiServer(t)).get(
      `/api/share/${share.token}/assets/${outsider.id}/stream`,
    )
    expect(res.status).toBe(404)
    const missing = await request(apiServer(t)).get(
      `/api/share/${share.token}/assets/${randomUUID()}/stream`,
    )
    expect(missing.status).toBe(404)
  })

  it('serves the sm thumbnail with ?size=sm and falls back to the original', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const album = await createAlbum(userId)
    const originalFile = await seedFile(t, userId, { mimeType: 'image/png' })
    const asset = await seedAsset(t, userId, originalFile.id)
    await addMember(album.id, asset.id)
    const created = await createShare(token, { albumId: album.id })
    const share = created.body as ShareBody

    const fallback = await request(apiServer(t)).get(
      `/api/share/${share.token}/assets/${asset.id}/stream?size=sm`,
    )
    expect(fallback.status).toBe(200)
    expect(fallback.headers['content-type']).toBe('image/png')

    const thumb = await seedThumbnail(t, asset.id, { size: 'sm' })
    const thumbFile = await t.fileRepo.findOneOrFail({ where: { id: thumb.fileId } })
    const thumbRes = await request(apiServer(t)).get(
      `/api/share/${share.token}/assets/${asset.id}/stream?size=sm`,
    )
    expect(thumbRes.status).toBe(200)
    expect(thumbRes.headers['content-type']).toBe('image/jpeg')
    expect(thumbRes.headers.etag).toBe(`"${thumbFile.checksumSha256}"`)

    const original = await request(apiServer(t)).get(
      `/api/share/${share.token}/assets/${asset.id}/stream`,
    )
    expect(original.headers['content-type']).toBe('image/png')
  })

  it('keeps asset shares working (kind:asset) and rejects album routes on them', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const file = await seedFile(t, userId)
    const asset = await seedAsset(t, userId, file.id)
    const created = await createShare(token, { assetId: asset.id })
    const share = created.body as ShareBody
    expect(share.kind).toBe('asset')

    const pub = await request(apiServer(t)).get(`/api/share/${share.token}`)
    expect(pub.status).toBe(200)
    const body = pub.body as { kind: string; asset: PublicAsset; share: ShareBody }
    expect(body.kind).toBe('asset')
    expect(body.share.kind).toBe('asset')
    expect(body.asset.id).toBe(asset.id)

    const stream = await request(apiServer(t)).get(`/api/share/${share.token}/stream`)
    expect(stream.status).toBe(200)

    const assetsRoute = await request(apiServer(t)).get(`/api/share/${share.token}/assets`)
    expect(assetsRoute.status).toBe(404)
  })

  it('serves the transcoded derivative on a shared video, not the unplayable original', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const original = await seedFile(t, userId, {
      bytes: Buffer.from('hevc-original-bytes'),
      mimeType: 'video/quicktime',
    })
    const transcode = await seedFile(t, userId, {
      bytes: Buffer.from('av1-webm-transcoded'),
      mimeType: 'video/webm',
    })
    const asset = await seedAsset(t, userId, original.id, {
      kind: 'video',
      transcodeFileId: transcode.id,
      transcodeStatus: 'ready',
    })
    const created = await createShare(token, { assetId: asset.id })
    const share = created.body as ShareBody

    const pub = await request(apiServer(t)).get(`/api/share/${share.token}`)
    expect((pub.body as { asset: PublicAsset }).asset.transcodeFileId).toBe(transcode.id)

    const stream = await request(apiServer(t)).get(`/api/share/${share.token}/stream`)
    expect(stream.status).toBe(200)
    expect(stream.headers['content-type']).toBe('video/webm')
    const record = await t.fileRepo.findOneOrFail({ where: { id: transcode.id } })
    expect(stream.headers.etag).toBe(`"${record.checksumSha256}"`)
  })

  it('serves the transcode for a shared album video member and keeps ?size=sm on the thumb', async () => {
    const { id: userId, token } = await seedUserWithToken()
    const album = await createAlbum(userId)
    const original = await seedFile(t, userId, {
      bytes: Buffer.from('hevc-original-bytes'),
      mimeType: 'video/quicktime',
    })
    const transcode = await seedFile(t, userId, {
      bytes: Buffer.from('av1-webm-transcoded'),
      mimeType: 'video/webm',
    })
    const asset = await seedAsset(t, userId, original.id, {
      kind: 'video',
      transcodeFileId: transcode.id,
      transcodeStatus: 'ready',
    })
    const thumb = await seedThumbnail(t, asset.id, { size: 'sm' })
    await addMember(album.id, asset.id)
    const created = await createShare(token, { albumId: album.id })
    const share = created.body as ShareBody

    const list = await request(apiServer(t)).get(`/api/share/${share.token}/assets`)
    const item = (list.body as { items: PublicAsset[] }).items[0]!
    expect(item.transcodeFileId).toBe(transcode.id)

    const stream = await request(apiServer(t)).get(
      `/api/share/${share.token}/assets/${asset.id}/stream`,
    )
    expect(stream.status).toBe(200)
    expect(stream.headers['content-type']).toBe('video/webm')
    const record = await t.fileRepo.findOneOrFail({ where: { id: transcode.id } })
    expect(stream.headers.etag).toBe(`"${record.checksumSha256}"`)

    const sm = await request(apiServer(t)).get(
      `/api/share/${share.token}/assets/${asset.id}/stream?size=sm`,
    )
    expect(sm.status).toBe(200)
    const thumbRecord = await t.fileRepo.findOneOrFail({ where: { id: thumb.fileId } })
    expect(sm.headers.etag).toBe(`"${thumbRecord.checksumSha256}"`)
  })
})
