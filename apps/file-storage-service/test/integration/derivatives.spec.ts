import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { MinioService } from '../../src/storage/minio.service'
import { FileRecord } from '../../src/entities/file-record.entity'
import { getRepositoryToken } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { createTestApp, closeTestApp, mintUserId, sha256 } from './helpers'
import type { FileRecord as FileRecordResponse } from '@photox/shared-types'

let app: INestApplication
let httpServer: Server
let minioService: MinioService
let fileRepo: Repository<FileRecord>

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
  minioService = app.get(MinioService)
  fileRepo = app.get(getRepositoryToken(FileRecord))
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('POST /v1/files/derivatives', () => {
  it('DER-01: registers a derivative, returns record with purpose=transcode, assetId matches, MinIO object exists', async () => {
    const userId = mintUserId()
    const assetId = mintUserId()
    const content = Buffer.from('fake-transcoded-video-bytes-der-01')
    const filename = 'transcoded.mp4'
    const mimeType = 'video/mp4'

    const res = await supertest(httpServer)
      .post('/v1/files/derivatives')
      .field('userId', userId)
      .field('assetId', assetId)
      .attach('file', content, { filename, contentType: mimeType })
      .expect(201)

    const body = res.body as FileRecordResponse
    expect(typeof body.id).toBe('string')
    expect(body.userId).toBe(userId)
    expect(body.assetId).toBe(assetId)
    expect(body.purpose).toBe('transcode')
    expect(body.originalName).toBe(filename)
    expect(body.mimeType).toBe(mimeType)
    expect(body.sizeBytes).toBe(content.length)
    expect(body.checksumSha256).toBe(sha256(content))

    const stat = await minioService.statFile(body.storageKey)
    expect(stat.size).toBe(content.length)

    const dbRecord = await fileRepo.findOne({ where: { id: body.id } })
    expect(dbRecord).not.toBeNull()
    expect(dbRecord!.purpose).toBe('transcode')
    expect(dbRecord!.assetId).toBe(assetId)
  })

  it('DER-02: dedup — same content + same userId + same assetId returns same fileId', async () => {
    const userId = mintUserId()
    const assetId = mintUserId()
    const content = Buffer.from('dedup-derivative-content-der-02')

    const res1 = await supertest(httpServer)
      .post('/v1/files/derivatives')
      .field('userId', userId)
      .field('assetId', assetId)
      .attach('file', content, { filename: 'out.mp4', contentType: 'video/mp4' })
      .expect(201)

    const res2 = await supertest(httpServer)
      .post('/v1/files/derivatives')
      .field('userId', userId)
      .field('assetId', assetId)
      .attach('file', content, { filename: 'out.mp4', contentType: 'video/mp4' })
      .expect(201)

    const body1 = res1.body as FileRecordResponse
    const body2 = res2.body as FileRecordResponse

    expect(body2.id).toBe(body1.id)
    expect(body2.storageKey).toBe(body1.storageKey)

    const count = await fileRepo.count({
      where: { userId, checksumSha256: sha256(content), assetId, purpose: 'transcode' },
    })
    expect(count).toBe(1)
  })

  it('DER-03: different user — same content + different userId returns different fileId', async () => {
    const userId1 = mintUserId()
    const userId2 = mintUserId()
    const assetId = mintUserId()
    const content = Buffer.from('diff-user-derivative-content-der-03')

    const res1 = await supertest(httpServer)
      .post('/v1/files/derivatives')
      .field('userId', userId1)
      .field('assetId', assetId)
      .attach('file', content, { filename: 'out.mp4', contentType: 'video/mp4' })
      .expect(201)

    const res2 = await supertest(httpServer)
      .post('/v1/files/derivatives')
      .field('userId', userId2)
      .field('assetId', assetId)
      .attach('file', content, { filename: 'out.mp4', contentType: 'video/mp4' })
      .expect(201)

    const body1 = res1.body as FileRecordResponse
    const body2 = res2.body as FileRecordResponse

    expect(body2.id).not.toBe(body1.id)
    expect(body1.userId).toBe(userId1)
    expect(body2.userId).toBe(userId2)
  })

  it('DER-04: different assetId — same content + same userId + different assetId returns different fileId', async () => {
    const userId = mintUserId()
    const assetId1 = mintUserId()
    const assetId2 = mintUserId()
    const content = Buffer.from('diff-asset-derivative-content-der-04')

    const res1 = await supertest(httpServer)
      .post('/v1/files/derivatives')
      .field('userId', userId)
      .field('assetId', assetId1)
      .attach('file', content, { filename: 'out.mp4', contentType: 'video/mp4' })
      .expect(201)

    const res2 = await supertest(httpServer)
      .post('/v1/files/derivatives')
      .field('userId', userId)
      .field('assetId', assetId2)
      .attach('file', content, { filename: 'out.mp4', contentType: 'video/mp4' })
      .expect(201)

    const body1 = res1.body as FileRecordResponse
    const body2 = res2.body as FileRecordResponse

    expect(body2.id).not.toBe(body1.id)
    expect(body1.assetId).toBe(assetId1)
    expect(body2.assetId).toBe(assetId2)
  })

  it('DER-05: returns 400 when no file is attached', async () => {
    const userId = mintUserId()
    const assetId = mintUserId()

    await supertest(httpServer)
      .post('/v1/files/derivatives')
      .field('userId', userId)
      .field('assetId', assetId)
      .expect(400)
  })

  it('DER-06: returns 400 when userId field is missing', async () => {
    const assetId = mintUserId()
    const content = Buffer.from('test-derivative')

    await supertest(httpServer)
      .post('/v1/files/derivatives')
      .field('assetId', assetId)
      .attach('file', content, { filename: 'test.mp4', contentType: 'video/mp4' })
      .expect(400)
  })
})
