import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'
import type { Asset, AssetListResponse } from '@photox/shared-types'

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

describe('POST /v1/assets/:id/trash', () => {
  it('UC-U10: trash an active asset — 204, isTrashed=true, trashedAt set', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer).post(`/v1/assets/${created.id}/trash`).query({ userId }).expect(204)

    const getRes = await supertest(httpServer)
      .get(`/v1/assets/${created.id}`)
      .query({ userId })
      .expect(200)

    const body = getRes.body as Asset
    expect(body.isTrashed).toBe(true)
    expect(body.trashedAt).not.toBeNull()
    expect(typeof body.trashedAt).toBe('string')
    expect(new Date(body.trashedAt!).toISOString()).toBe(body.trashedAt!)
  })

  it('UC-U10: trashed asset disappears from default list', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer).post(`/v1/assets/${created.id}/trash`).query({ userId }).expect(204)

    const listRes = await supertest(httpServer).get('/v1/assets').query({ userId }).expect(200)

    const listBody = listRes.body as AssetListResponse
    expect(listBody.total).toBe(0)
    expect(listBody.items).toHaveLength(0)
  })

  it('UC-U10: trashed asset appears in isTrashed=true list', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer).post(`/v1/assets/${created.id}/trash`).query({ userId }).expect(204)

    const listRes = await supertest(httpServer)
      .get('/v1/assets?isTrashed=true')
      .query({ userId })
      .expect(200)

    const listBody = listRes.body as AssetListResponse
    expect(listBody.total).toBe(1)
    expect(listBody.items[0]!.id).toBe(created.id)
  })

  it('UC-U11: trash an already-trashed asset is idempotent — 204, trashedAt unchanged', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer).post(`/v1/assets/${created.id}/trash`).query({ userId }).expect(204)

    const afterFirst = await supertest(httpServer)
      .get(`/v1/assets/${created.id}`)
      .query({ userId })
      .expect(200)

    const firstTrashedAt = (afterFirst.body as Asset).trashedAt

    await supertest(httpServer).post(`/v1/assets/${created.id}/trash`).query({ userId }).expect(204)

    const afterSecond = await supertest(httpServer)
      .get(`/v1/assets/${created.id}`)
      .query({ userId })
      .expect(200)

    const body = afterSecond.body as Asset
    expect(body.isTrashed).toBe(true)
    expect(body.trashedAt).toBe(firstTrashedAt)
  })

  it('UC-U20: returns 404 for non-existent asset id', async () => {
    const userId = mintUserId()
    const fakeId = '00000000-0000-0000-0000-000000000000'

    const res = await supertest(httpServer)
      .post(`/v1/assets/${fakeId}/trash`)
      .query({ userId })
      .expect(404)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })
})

describe('POST /v1/assets/:id/restore', () => {
  it('UC-U12: restore a trashed asset — 204, isTrashed=false, trashedAt=null', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer).post(`/v1/assets/${created.id}/trash`).query({ userId }).expect(204)

    await supertest(httpServer)
      .post(`/v1/assets/${created.id}/restore`)
      .query({ userId })
      .expect(204)

    const getRes = await supertest(httpServer)
      .get(`/v1/assets/${created.id}`)
      .query({ userId })
      .expect(200)

    const body = getRes.body as Asset
    expect(body.isTrashed).toBe(false)
    expect(body.trashedAt).toBeNull()
  })

  it('UC-U12: restored asset reappears in default list', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer).post(`/v1/assets/${created.id}/trash`).query({ userId }).expect(204)

    await supertest(httpServer)
      .post(`/v1/assets/${created.id}/restore`)
      .query({ userId })
      .expect(204)

    const listRes = await supertest(httpServer).get('/v1/assets').query({ userId }).expect(200)

    const listBody = listRes.body as AssetListResponse
    expect(listBody.total).toBe(1)
    expect(listBody.items[0]!.id).toBe(created.id)
  })

  it('UC-U13: restore an active asset is idempotent — 204, no state change', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .post(`/v1/assets/${created.id}/restore`)
      .query({ userId })
      .expect(204)

    const getRes = await supertest(httpServer)
      .get(`/v1/assets/${created.id}`)
      .query({ userId })
      .expect(200)

    const body = getRes.body as Asset
    expect(body.isTrashed).toBe(false)
    expect(body.trashedAt).toBeNull()
  })

  it('UC-U20: returns 404 for non-existent asset id', async () => {
    const userId = mintUserId()
    const fakeId = '00000000-0000-0000-0000-000000000000'

    const res = await supertest(httpServer)
      .post(`/v1/assets/${fakeId}/restore`)
      .query({ userId })
      .expect(404)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })
})
