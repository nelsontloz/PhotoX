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

describe('POST /v1/files', () => {
  it('UC-U1: uploads a photo, returns FileRecordDto, MinIO object present, checksum matches', async () => {
    const userId = mintUserId()
    const content = Buffer.from('fake-image-bytes-for-test')
    const filename = 'photo.png'
    const mimeType = 'image/png'

    const res = await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId)
      .attach('file', content, { filename, contentType: mimeType })
      .expect(201)

    const body = res.body as FileRecordResponse
    expect(typeof body.id).toBe('string')
    expect(body.userId).toBe(userId)
    expect(body.originalName).toBe(filename)
    expect(body.mimeType).toBe(mimeType)
    expect(body.sizeBytes).toBe(content.length)
    expect(body.checksumSha256).toBe(sha256(content))
    expect(typeof body.createdAt).toBe('string')

    const minioExists = await minioService.fileExists(body.storageKey)
    expect(minioExists).toBe(true)

    const dbRecord = await fileRepo.findOne({ where: { id: body.id } })
    expect(dbRecord).not.toBeNull()
    expect(dbRecord!.checksumSha256).toBe(sha256(content))
  })

  it('UC-U2: uploads a video with video/* MIME', async () => {
    const userId = mintUserId()
    const content = Buffer.from('fake-video-bytes-for-test')
    const filename = 'clip.mp4'
    const mimeType = 'video/mp4'

    const res = await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId)
      .attach('file', content, { filename, contentType: mimeType })
      .expect(201)

    const body = res.body as FileRecordResponse
    expect(body.mimeType).toBe(mimeType)
    expect(body.originalName).toBe(filename)
    expect(body.sizeBytes).toBe(content.length)
    expect(body.checksumSha256).toBe(sha256(content))

    const minioExists = await minioService.fileExists(body.storageKey)
    expect(minioExists).toBe(true)

    const dbRecord = await fileRepo.findOne({ where: { id: body.id } })
    expect(dbRecord).not.toBeNull()
  })

  it('returns 400 when no file is attached', async () => {
    const userId = mintUserId()

    const res = await supertest(httpServer).post('/v1/files').field('userId', userId).expect(400)

    expect(res.body).toBeDefined()
  })

  it('returns 400 when userId field is missing', async () => {
    const content = Buffer.from('test')

    await supertest(httpServer)
      .post('/v1/files')
      .attach('file', content, { filename: 'test.png', contentType: 'image/png' })
      .expect(400)
  })
})
