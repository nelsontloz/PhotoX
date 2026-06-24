import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { MinioService } from '../../src/storage/minio.service'
import { FileRecord } from '../../src/entities/file-record.entity'
import { getRepositoryToken } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { createTestApp, closeTestApp, mintUserId, sha256 } from './helpers'
import type { FileRecord as FileRecordResponse } from '@photox/shared-types'
import { loadEnv } from '@photox/shared-config'

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

describe('POST /v1/files — dedup', () => {
  it('UC-DEDUP-1: same content + same user returns same fileId (idempotent)', async () => {
    const userId = mintUserId()
    const content = Buffer.from('dedup-test-content-unique-1')
    const checksum = sha256(content)

    const res1 = await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId)
      .attach('file', content, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201)

    const body1 = res1.body as FileRecordResponse

    const res2 = await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId)
      .attach('file', content, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201)

    const body2 = res2.body as FileRecordResponse

    expect(body2.id).toBe(body1.id)
    expect(body2.storageKey).toBe(body1.storageKey)
    expect(body2.checksumSha256).toBe(checksum)
    expect(body2.userId).toBe(userId)
  })

  it('UC-DEDUP-2: does not create a duplicate DB row', async () => {
    const userId = mintUserId()
    const content = Buffer.from('dedup-test-content-unique-2')
    const checksum = sha256(content)

    await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId)
      .attach('file', content, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201)

    await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId)
      .attach('file', content, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201)

    const count = await fileRepo.count({ where: { userId, checksumSha256: checksum } })
    expect(count).toBe(1)
  })

  it('UC-DEDUP-3: does not create a duplicate MinIO object', async () => {
    const userId = mintUserId()
    const content = Buffer.from('dedup-test-content-unique-3')
    const env = loadEnv()

    const res1 = await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId)
      .attach('file', content, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201)

    const body1 = res1.body as FileRecordResponse

    await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId)
      .attach('file', content, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201)

    const client = minioService.getClient()
    const objects = await new Promise<string[]>((resolve, reject) => {
      const keys: string[] = []
      const stream = client.listObjects(env.MINIO_BUCKET, `${userId}/`, false)
      stream.on('data', (obj) => {
        if (obj.name) keys.push(obj.name)
      })
      stream.on('end', () => resolve(keys))
      stream.on('error', reject)
    })

    expect(objects).toContain(body1.storageKey)
    const matchingObjects = objects.filter((obj) => obj.startsWith(userId))
    expect(matchingObjects).toHaveLength(1)
  })

  it('UC-DEDUP-4: different user uploading same content gets a new fileId', async () => {
    const userId1 = mintUserId()
    const userId2 = mintUserId()
    const content = Buffer.from('dedup-test-content-unique-4')

    const res1 = await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId1)
      .attach('file', content, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201)

    const res2 = await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId2)
      .attach('file', content, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201)

    const body1 = res1.body as FileRecordResponse
    const body2 = res2.body as FileRecordResponse

    expect(body2.id).not.toBe(body1.id)
    expect(body2.userId).toBe(userId2)
    expect(body1.userId).toBe(userId1)
  })

  it('UC-DEDUP-5: dedup returns the original createdAt', async () => {
    const userId = mintUserId()
    const content = Buffer.from('dedup-test-content-unique-5')

    const res1 = await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId)
      .attach('file', content, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201)

    const body1 = res1.body as FileRecordResponse

    const res2 = await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId)
      .attach('file', content, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201)

    const body2 = res2.body as FileRecordResponse

    expect(body2.createdAt).toBe(body1.createdAt)
  })

  it('UC-DEDUP-6: dedup returns original filename/mimeType, not the new request fields', async () => {
    const userId = mintUserId()
    const content = Buffer.from('dedup-test-content-unique-6')

    const res1 = await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId)
      .attach('file', content, { filename: 'original.png', contentType: 'image/png' })
      .expect(201)

    const body1 = res1.body as FileRecordResponse

    const res2 = await supertest(httpServer)
      .post('/v1/files')
      .field('userId', userId)
      .attach('file', content, { filename: 'renamed.jpg', contentType: 'image/jpeg' })
      .expect(201)

    const body2 = res2.body as FileRecordResponse

    expect(body2.originalName).toBe('original.png')
    expect(body2.mimeType).toBe('image/png')
    expect(body2.originalName).toBe(body1.originalName)
    expect(body2.mimeType).toBe(body1.mimeType)
  })
})
