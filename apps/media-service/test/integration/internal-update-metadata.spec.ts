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

  it('UC-I14: full EXIF payload persists all new fields and returns them', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const payload = {
      status: 'ready',
      lensModel: 'RF 24-70mm F2.8 L IS USM',
      iso: 400,
      fNumber: 2.8,
      exposureTime: 0.004,
      focalLength: 85,
      altitude: 1542.137,
      metadata: { Make: 'Canon', Model: 'EOS R5', ISO: 400 },
    }

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send(payload)
      .expect(200)

    const body = res.body as Asset
    expect(body.metadataStatus).toBe('ready')
    expect(body.lensModel).toBe('RF 24-70mm F2.8 L IS USM')
    expect(body.iso).toBe(400)
    expect(body.fNumber).toBeCloseTo(2.8, 1)
    expect(body.exposureTime).toBeCloseTo(0.004, 6)
    expect(body.focalLength).toBeCloseTo(85, 1)
    expect(body.altitude).toBeCloseTo(1542.137, 3)
    expect(body.metadata).toEqual({ Make: 'Canon', Model: 'EOS R5', ISO: 400 })
  })

  it('UC-I15: takenAt ISO string accepted, persisted as Date, returned as ISO', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'ready', takenAt: '2024-08-15T14:30:00.000Z' })
      .expect(200)

    const body = res.body as Asset
    expect(body.takenAt).toBe('2024-08-15T14:30:00.000Z')
  })

  it('UC-I16: takenAt null is accepted (200) — @IsOptional allows null through, column is nullable', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'ready', takenAt: null })
      .expect(200)

    const body = res.body as Asset
    expect(body.takenAt).toBeNull()
  })

  it('UC-I17: negative iso returns 400 (@Min(0))', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'ready', iso: -1 })
      .expect(400)
  })

  it('UC-I18: negative altitude returns 400 (@Min(0))', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'ready', altitude: -100 })
      .expect(400)
  })

  it('UC-I19: metadata jsonb round-trips with nested objects and arrays', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const metadataPayload = {
      Make: 'Sony',
      Model: 'A7 IV',
      nested: { key: [1, 2, 3] },
    }

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'ready', metadata: metadataPayload })
      .expect(200)

    const body = res.body as Asset
    expect(body.metadata).toEqual(metadataPayload)
  })

  it('UC-I20: partial update — new EXIF fields only, pre-EXIF fields untouched', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'ready', mimeType: 'image/jpeg', codec: 'h264' })
      .expect(200)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({ status: 'ready', lensModel: 'EF 50mm f/1.8', iso: 200, fNumber: 1.8 })
      .expect(200)

    const body = res.body as Asset
    expect(body.lensModel).toBe('EF 50mm f/1.8')
    expect(body.iso).toBe(200)
    expect(body.fNumber).toBeCloseTo(1.8, 1)
    expect(body.mimeType).toBe('image/jpeg')
    expect(body.codec).toBe('h264')
    expect(body.metadataStatus).toBe('ready')
  })

  it('UC-I21: decimal precision preserved through numeric columns', async () => {
    const userId = mintUserId()
    const created = await createAssetForUser(httpServer, userId)

    const res = await supertest(httpServer)
      .patch(`/v1/assets/${created.id}/metadata`)
      .send({
        status: 'ready',
        fNumber: 2.8,
        focalLength: 85.0,
        altitude: 1542.137,
        exposureTime: 0.004,
      })
      .expect(200)

    const body = res.body as Asset
    expect(body.fNumber).toBeCloseTo(2.8, 1)
    expect(body.focalLength).toBeCloseTo(85.0, 1)
    expect(body.altitude).toBeCloseTo(1542.137, 3)
    expect(body.exposureTime).toBeCloseTo(0.004, 6)
  })
})
