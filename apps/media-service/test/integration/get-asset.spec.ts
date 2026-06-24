import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'
import type { Asset } from '@photox/shared-types'

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

describe('GET /v1/assets/:id', () => {
  it('UC-U7: returns the asset by id with full response', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId, {
      title: 'Test Title',
      description: 'Test Description',
    })

    const res = await supertest(httpServer)
      .get(`/v1/assets/${created.id}`)
      .query({ userId })
      .expect(200)

    const body = res.body as Asset
    expect(body.id).toBe(created.id)
    expect(body.userId).toBe(userId)
    expect(body.title).toBe('Test Title')
    expect(body.description).toBe('Test Description')
    expect(body.kind).toBe('photo')
  })

  it('UC-U20: returns 404 for non-existent asset id', async () => {
    const userId = mintUserId()
    const fakeId = '00000000-0000-0000-0000-000000000000'

    const res = await supertest(httpServer)
      .get(`/v1/assets/${fakeId}`)
      .query({ userId })
      .expect(404)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })
})
