import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createTestApp, closeTestApp, mintUserId, assetPayload } from './helpers'
import type { Asset } from '@photox/shared-types'

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

describe('POST /v1/assets', () => {
  it('UC-U1: creates a photo asset with minimal body — defaults are set', async () => {
    const userId = mintUserId()
    const payload = { fileId: randomUUID(), kind: 'photo' as const }

    const res = await supertest(httpServer)
      .post('/v1/assets')
      .set('x-user-id', userId)
      .send(payload)
      .expect(201)

    const body = res.body as Asset
    expect(typeof body.id).toBe('string')
    expect(body.userId).toBe(userId)
    expect(body.kind).toBe('photo')
    expect(body.fileId).toBe(payload.fileId)
    expect(body.isTrashed).toBe(false)
    expect(body.favorite).toBe(false)
    expect(body.metadataStatus).toBe('pending')
    expect(body.title).toBeNull()
    expect(body.description).toBeNull()
    expect(body.takenAt).toBeNull()
    expect(body.trashedAt).toBeNull()
    expect(typeof body.uploadedAt).toBe('string')
  })

  it('UC-U2: creates a video asset with all optional fields', async () => {
    const userId = mintUserId()
    const payload = {
      fileId: randomUUID(),
      kind: 'video' as const,
      title: 'My Vacation',
      description: 'A beautiful sunset timelapse',
      takenAt: '2025-06-15T14:30:00.000Z',
    }

    const res = await supertest(httpServer)
      .post('/v1/assets')
      .set('x-user-id', userId)
      .send(payload)
      .expect(201)

    const body = res.body as Asset
    expect(body.kind).toBe('video')
    expect(body.title).toBe(payload.title)
    expect(body.description).toBe(payload.description)
    expect(body.takenAt).toBe(payload.takenAt)
  })

  it('UC-U17: returns 400 when fileId is not a UUID', async () => {
    const userId = mintUserId()

    const res = await supertest(httpServer)
      .post('/v1/assets')
      .set('x-user-id', userId)
      .send({ fileId: 'not-a-uuid', kind: 'photo' })
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })

  it('UC-U18: returns 400 when kind is not photo or video', async () => {
    const userId = mintUserId()

    const res = await supertest(httpServer)
      .post('/v1/assets')
      .set('x-user-id', userId)
      .send({ fileId: randomUUID(), kind: 'document' })
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })

  it('UC-U19: returns 400 on unknown body field (forbidNonWhitelisted)', async () => {
    const userId = mintUserId()

    const res = await supertest(httpServer)
      .post('/v1/assets')
      .set('x-user-id', userId)
      .send({ ...assetPayload(), hack: 'injected' })
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBeDefined()
  })
})
