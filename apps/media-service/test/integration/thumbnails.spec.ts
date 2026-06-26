import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'
import type { AssetThumbnail } from '@photox/shared-types'

interface ErrorBody {
  message: string | string[]
}

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

const thumb = (
  overrides: Partial<{
    size: string
    fileId: string
    width: number
    height: number
    bytes: number
  }> = {},
) => ({
  size: 'sm',
  fileId: randomUUID(),
  width: 320,
  height: 240,
  bytes: 24576,
  ...overrides,
})

describe('POST /v1/assets/:id/thumbnails', () => {
  it('UC-T1: registers a new thumbnail (201)', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)
    const payload = thumb()

    const res = await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/thumbnails`)
      .send(payload)
      .expect(201)

    const body = res.body as AssetThumbnail
    expect(body.size).toBe(payload.size)
    expect(body.fileId).toBe(payload.fileId)
    expect(body.width).toBe(payload.width)
    expect(body.height).toBe(payload.height)
    expect(body.bytes).toBe(payload.bytes)
    expect(typeof body.createdAt).toBe('string')
  })

  it('UC-T2: register is idempotent on (assetId, size) — second call upserts and updates fileId', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)
    const first = thumb()
    const second = { ...first, fileId: randomUUID(), bytes: 99999 }

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/thumbnails`)
      .send(first)
      .expect(201)

    const secondRes = await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/thumbnails`)
      .send(second)
      .expect(201)

    expect((secondRes.body as AssetThumbnail).fileId).toBe(second.fileId)
    expect((secondRes.body as AssetThumbnail).bytes).toBe(99999)

    const listRes = await supertest(httpServer)
      .get(`/v1/assets/${asset.id}/thumbnails`)
      .query({ userId })
      .expect(200)
    expect(listRes.body).toHaveLength(1)
    expect((listRes.body as AssetThumbnail[])[0]!.fileId).toBe(second.fileId)
  })

  it('UC-T3: register returns 404 for unknown asset', async () => {
    const res = await supertest(httpServer)
      .post(`/v1/assets/${randomUUID()}/thumbnails`)
      .send(thumb())
      .expect(404)

    expect((res.body as ErrorBody).message).toBeDefined()
  })

  it('UC-T4: register rejects missing required field (size)', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/thumbnails`)
      .send({ fileId: randomUUID(), width: 320, height: 240, bytes: 24576 })
      .expect(400)
  })

  it('UC-T4b: register rejects non-UUID fileId', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/thumbnails`)
      .send({ ...thumb(), fileId: 'not-a-uuid' })
      .expect(400)
  })

  it('UC-T4c: register rejects width < 1', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/thumbnails`)
      .send({ ...thumb(), width: 0 })
      .expect(400)
  })

  it('UC-T5: register allows multiple sizes for the same asset', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    for (const size of ['sm', 'md', 'lg']) {
      await supertest(httpServer)
        .post(`/v1/assets/${asset.id}/thumbnails`)
        .send(thumb({ size }))
        .expect(201)
    }

    const res = await supertest(httpServer)
      .get(`/v1/assets/${asset.id}/thumbnails`)
      .query({ userId })
      .expect(200)

    const sizes = (res.body as AssetThumbnail[]).map((t) => t.size).sort()
    expect(sizes).toEqual(['lg', 'md', 'sm'])
  })
})

describe('GET /v1/assets/:id/thumbnails', () => {
  it('UC-T6: list returns empty for asset with no thumbnails', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .get(`/v1/assets/${asset.id}/thumbnails`)
      .query({ userId })
      .expect(200)

    expect(res.body).toEqual([])
  })

  it('UC-T7: list returns all registered thumbnails, ordered by createdAt ASC', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    for (const size of ['sm', 'md', 'lg']) {
      await supertest(httpServer)
        .post(`/v1/assets/${asset.id}/thumbnails`)
        .send(thumb({ size }))
        .expect(201)
    }

    const res = await supertest(httpServer)
      .get(`/v1/assets/${asset.id}/thumbnails`)
      .query({ userId })
      .expect(200)

    expect((res.body as AssetThumbnail[]).map((t) => t.size)).toEqual(['sm', 'md', 'lg'])
  })

  it('UC-T8: list returns 404 for unknown asset', async () => {
    const res = await supertest(httpServer)
      .get(`/v1/assets/${randomUUID()}/thumbnails`)
      .query({ userId: mintUserId() })
      .expect(404)

    expect((res.body as ErrorBody).message).toBeDefined()
  })

  it("UC-T9: list returns 404 for another user's asset", async () => {
    const owner = mintUserId()
    const other = mintUserId()
    const asset = await createAssetForUser(httpServer, owner)
    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/thumbnails`)
      .send(thumb())
      .expect(201)

    const res = await supertest(httpServer)
      .get(`/v1/assets/${asset.id}/thumbnails`)
      .query({ userId: other })
      .expect(404)

    expect((res.body as ErrorBody).message).toBeDefined()
  })
})

describe('GET /v1/assets/:id/thumbnails/:size', () => {
  it('UC-T10: getOne returns the requested size', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)
    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/thumbnails`)
      .send(thumb({ size: 'md' }))
      .expect(201)
    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/thumbnails`)
      .send(thumb({ size: 'lg' }))
      .expect(201)

    const res = await supertest(httpServer)
      .get(`/v1/assets/${asset.id}/thumbnails/md`)
      .query({ userId })
      .expect(200)

    const body = res.body as AssetThumbnail
    expect(body.size).toBe('md')
  })

  it('UC-T11: getOne returns 404 for missing size', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)
    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/thumbnails`)
      .send(thumb({ size: 'sm' }))
      .expect(201)

    const res = await supertest(httpServer)
      .get(`/v1/assets/${asset.id}/thumbnails/nope`)
      .query({ userId })
      .expect(404)

    expect((res.body as ErrorBody).message).toBeDefined()
  })

  it('UC-T12: getOne returns 404 for unknown asset', async () => {
    const res = await supertest(httpServer)
      .get(`/v1/assets/${randomUUID()}/thumbnails/sm`)
      .query({ userId: mintUserId() })
      .expect(404)

    expect((res.body as ErrorBody).message).toBeDefined()
  })

  it("UC-T13: getOne returns 404 for another user's asset", async () => {
    const owner = mintUserId()
    const other = mintUserId()
    const asset = await createAssetForUser(httpServer, owner)
    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/thumbnails`)
      .send(thumb())
      .expect(201)

    const res = await supertest(httpServer)
      .get(`/v1/assets/${asset.id}/thumbnails/sm`)
      .query({ userId: other })
      .expect(404)

    expect((res.body as ErrorBody).message).toBeDefined()
  })
})

describe('DELETE /v1/assets/:id/thumbnails/:size', () => {
  it('UC-T14: unregister removes the thumbnail (subsequent getOne 404)', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)
    await supertest(httpServer)
      .post(`/v1/assets/${asset.id}/thumbnails`)
      .send(thumb({ size: 'sm' }))
      .expect(201)

    await supertest(httpServer)
      .delete(`/v1/assets/${asset.id}/thumbnails/sm`)
      .expect(204)

    await supertest(httpServer)
      .get(`/v1/assets/${asset.id}/thumbnails/sm`)
      .query({ userId })
      .expect(404)
  })

  it('UC-T15: unregister is idempotent — 204 even when size is already gone', async () => {
    const userId = mintUserId()
    const asset = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .delete(`/v1/assets/${asset.id}/thumbnails/never-existed`)
      .expect(204)
  })

  it('UC-T16: unregister returns 404 for unknown asset', async () => {
    const res = await supertest(httpServer)
      .delete(`/v1/assets/${randomUUID()}/thumbnails/sm`)
      .expect(404)

    expect((res.body as ErrorBody).message).toBeDefined()
  })
})
