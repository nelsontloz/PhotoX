import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'
import type { Asset } from '@photox/shared-types'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('GET /v1/internal/users/:userId/assets', () => {
  it('UC-I1: returns all assets for a user including trashed, sorted uploadedAt DESC', async () => {
    const userId = mintUserId()

    await createAssetForUser(httpServer, userId, { title: 'first' })
    const a2 = await createAssetForUser(httpServer, userId, { title: 'second' })
    await createAssetForUser(httpServer, userId, { title: 'third' })

    await supertest(httpServer)
      .post(`/v1/assets/${a2.id}/trash`)
      .set('x-user-id', userId)
      .expect(204)

    const res = await supertest(httpServer).get(`/v1/internal/users/${userId}/assets`).expect(200)

    const body = res.body as Asset[]
    expect(body).toHaveLength(3)

    const trashed = body.find((a) => a.id === a2.id)
    expect(trashed).toBeDefined()
    expect(trashed!.isTrashed).toBe(true)
    expect(trashed!.trashedAt).not.toBeNull()

    const uploadedAts = body.map((a) => new Date(a.uploadedAt).getTime())
    for (let i = 1; i < uploadedAts.length; i++) {
      expect(uploadedAts[i - 1]!).toBeGreaterThanOrEqual(uploadedAts[i]!)
    }
  })

  it('UC-I2: returns empty array for a user with no assets', async () => {
    const userId = mintUserId()

    const res = await supertest(httpServer).get(`/v1/internal/users/${userId}/assets`).expect(200)

    expect(res.body).toEqual([])
  })
})
