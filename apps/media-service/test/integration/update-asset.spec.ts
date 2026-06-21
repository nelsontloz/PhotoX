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

describe('PATCH /v1/assets/:id', () => {
  it('UC-U8: updates title only (partial update)', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .set('x-user-id', userId)
      .send({ title: 'Updated Title' })
      .expect(200)

    const body = res.body as Asset
    expect(body.title).toBe('Updated Title')
    expect(body.description).toBeNull()
  })

  it('UC-U8: updates all editable fields', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .set('x-user-id', userId)
      .send({
        title: 'New Title',
        description: 'New Description',
        favorite: true,
        takenAt: '2025-12-01T10:00:00.000Z',
      })
      .expect(200)

    const body = res.body as Asset
    expect(body.title).toBe('New Title')
    expect(body.description).toBe('New Description')
    expect(body.favorite).toBe(true)
    expect(body.takenAt).toBe('2025-12-01T10:00:00.000Z')
  })

  it('UC-U9: empty body {} is a no-op (200, unchanged)', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId, {
      title: 'Original',
      description: 'Original description',
    })

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .set('x-user-id', userId)
      .send({})
      .expect(200)

    const body = res.body as Asset
    expect(body.title).toBe('Original')
    expect(body.description).toBe('Original description')
  })

  it('UC-U20: returns 404 for non-existent asset id', async () => {
    const userId = mintUserId()
    const fakeId = '00000000-0000-0000-0000-000000000000'

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${fakeId}`)
      .set('x-user-id', userId)
      .send({ title: 'x' })
      .expect(404)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })

  it('UC-U22: title at max length 255 succeeds', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)
    const longTitle = 'a'.repeat(255)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .set('x-user-id', userId)
      .send({ title: longTitle })
      .expect(200)

    const body = res.body as Asset
    expect(body.title).toBe(longTitle)
  })

  it('UC-U22: title at 256 fails', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .set('x-user-id', userId)
      .send({ title: 'a'.repeat(256) })
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })

  it('UC-U23: description at max length 2000 succeeds', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)
    const longDesc = 'a'.repeat(2000)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .set('x-user-id', userId)
      .send({ description: longDesc })
      .expect(200)

    const body = res.body as Asset
    expect(body.description).toBe(longDesc)
  })

  it('UC-U23: description at 2001 fails', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .set('x-user-id', userId)
      .send({ description: 'a'.repeat(2001) })
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })

  it('UC-U24: takenAt must be ISO-8601 — valid string succeeds', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .set('x-user-id', userId)
      .send({ takenAt: '2025-06-20T12:00:00.000Z' })
      .expect(200)
  })

  it('UC-U24: takenAt must be ISO-8601 — non-ISO string fails', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}`)
      .set('x-user-id', userId)
      .send({ takenAt: 'not-a-date' })
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })
})
