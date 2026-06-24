import { type INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
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

describe('PATCH /v1/assets/:id/metadata', () => {
  it('UC-I6: status "ready" with full payload persists all fields and stamps metadataStatus + extractedAt', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const payload = {
      status: 'ready',
      mimeType: 'image/jpeg',
      sizeBytes: 123456,
      originalName: 'photo.jpg',
      width: 1920,
      height: 1080,
      durationSeconds: 0,
      fps: 0,
      codec: 'h264',
      hasAudio: false,
      cameraMake: 'Canon',
      cameraModel: 'EOS R5',
      orientation: 1,
      latitude: 48.8566,
      longitude: 2.3522,
    }

    const before = Date.now()
    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send(payload)
      .expect(200)
    const after = Date.now()

    const body = res.body as Asset
    expect(body.mimeType).toBe('image/jpeg')
    expect(body.sizeBytes).toBe(123456)
    expect(body.originalName).toBe('photo.jpg')
    expect(body.width).toBe(1920)
    expect(body.height).toBe(1080)
    expect(body.durationSeconds).toBe(0)
    expect(body.fps).toBe(0)
    expect(body.codec).toBe('h264')
    expect(body.hasAudio).toBe(false)
    expect(body.cameraMake).toBe('Canon')
    expect(body.cameraModel).toBe('EOS R5')
    expect(body.orientation).toBe(1)
    expect(body.latitude).toBeCloseTo(48.8566, 4)
    expect(body.longitude).toBeCloseTo(2.3522, 4)
    expect(body.metadataStatus).toBe('ready')
    expect(body.metadataExtractedAt).not.toBeNull()
    const extractedAt = new Date(body.metadataExtractedAt!).getTime()
    expect(extractedAt).toBeGreaterThanOrEqual(before - 1000)
    expect(extractedAt).toBeLessThanOrEqual(after + 1000)
  })

  it('UC-I7: status "failed" with no media fields sets metadataStatus failed, existing fields untouched', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'ready', mimeType: 'image/png', width: 800, height: 600 })
      .expect(200)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'failed' })
      .expect(200)

    const body = res.body as Asset
    expect(body.metadataStatus).toBe('failed')
    expect(body.mimeType).toBe('image/png')
    expect(body.width).toBe(800)
    expect(body.height).toBe(600)
    expect(body.metadataExtractedAt).not.toBeNull()
  })

  it('UC-I8: partial update — only width/height change, other fields untouched', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'ready', mimeType: 'video/mp4', codec: 'h265' })
      .expect(200)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'ready', width: 3840, height: 2160 })
      .expect(200)

    const body = res.body as Asset
    expect(body.width).toBe(3840)
    expect(body.height).toBe(2160)
    expect(body.mimeType).toBe('video/mp4')
    expect(body.codec).toBe('h265')
  })

  it('UC-I9: returns 404 for a non-existent asset id', async () => {
    const fakeId = randomUUID()

    await supertest(httpServer)
      .patch(`/v1/assets/${fakeId}/metadata`)
      .send({ status: 'ready' })
      .expect(404)
  })

  it('UC-I10: trashed asset — metadata update succeeds (trashed is transparent to internal)', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer).post(`/v1/assets/${created.id}/trash`).query({ userId }).expect(204)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'ready' })
      .expect(200)

    const body = res.body as Asset
    expect(body.metadataStatus).toBe('ready')
    expect(body.isTrashed).toBe(true)
  })

  it('UC-I11: status "processing" (not in enum) returns 400', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'processing' })
      .expect(400)
  })

  it('UC-I12: missing status field returns 400', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ mimeType: 'image/jpeg' })
      .expect(400)
  })

  it('UC-I13: width -1 returns 400 (@Min(0))', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'ready', width: -1 })
      .expect(400)
  })
})
