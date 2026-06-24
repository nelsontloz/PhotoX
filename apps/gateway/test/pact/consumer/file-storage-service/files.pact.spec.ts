/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import type { INestApplication } from '@nestjs/common'
import { MatchersV3 } from '@pact-foundation/pact'
import request from 'supertest'
import { SERVICE_URLS } from '@photox/shared-config'
import { createPact } from '../setup'
import { setupFileStorageServicePactModule } from './testing-module'
import type { StubProxy } from '../stub'

const fileStorage = createPact('file-storage-service')
let app: INestApplication
let stub: StubProxy

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'

const fileRecordMatcher = {
  id: MatchersV3.uuid(FILE_ID),
  userId: MatchersV3.uuid(USER_ID),
  storageKey: MatchersV3.string(`${USER_ID}/${FILE_ID}.png`),
  originalName: MatchersV3.string('photo.png'),
  mimeType: MatchersV3.string('image/png'),
  sizeBytes: MatchersV3.integer(12345),
  checksumSha256: MatchersV3.string('abc123def456'),
  createdAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
}

const fileListItemMatcher = {
  id: MatchersV3.uuid(FILE_ID),
  userId: MatchersV3.uuid(USER_ID),
  originalName: MatchersV3.string('photo.png'),
  mimeType: MatchersV3.string('image/png'),
  sizeBytes: MatchersV3.integer(12345),
  createdAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
}

beforeAll(async () => {
  const setup = await setupFileStorageServicePactModule()
  app = setup.app
  stub = setup.stub
}, 30_000)

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  stub.targetUrl = ''
  stub.targetUrls = {}
  stub.calls = []
  stub.interceptFn = undefined
})

describe('Gateway → file-storage-service files pact', () => {
  it('GET /v1/files — list files (empty)', async () => {
    await fileStorage
      .given('user has no files')
      .uponReceiving('a list files request')
      .withRequest({
        method: 'GET',
        path: '/v1/files',
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          items: [],
          total: 0,
          limit: 20,
          offset: 0,
        },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get('/api/v1/files')
        expect(res.status).toBe(200)
        expect(res.body.items).toEqual([])
        expect(res.body.total).toBe(0)
      })
  })

  it('GET /v1/files — list files (one item)', async () => {
    await fileStorage
      .given('user has one file')
      .uponReceiving('a list files request that returns one item')
      .withRequest({
        method: 'GET',
        path: '/v1/files',
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          items: [fileListItemMatcher],
          total: 1,
          limit: 20,
          offset: 0,
        },
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get('/api/v1/files')
        expect(res.status).toBe(200)
        expect(res.body.items).toHaveLength(1)
        expect(res.body.items[0].id).toBe(FILE_ID)
        expect(res.body.items[0].storageKey).toBeUndefined()
        expect(res.body.items[0].checksumSha256).toBeUndefined()
        expect(res.body.total).toBe(1)
      })
  })

  it('GET /v1/files/:fileId — get one file', async () => {
    await fileStorage
      .given('file exists with id ' + FILE_ID)
      .uponReceiving('a get file request')
      .withRequest({
        method: 'GET',
        path: `/v1/files/${FILE_ID}`,
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: fileRecordMatcher,
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).get(`/api/v1/files/${FILE_ID}`)
        expect(res.status).toBe(200)
        expect(res.body.id).toBe(FILE_ID)
      })
  })

  it('GET /v1/files/:fileId — file not found (404)', async () => {
    await fileStorage
      .given('file does not exist')
      .uponReceiving('a get file request for a missing file')
      .withRequest({
        method: 'GET',
        path: `/v1/files/${FILE_ID}`,
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          message: MatchersV3.string('File not found'),
        }),
      })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        await request(app.getHttpServer()).get(`/api/v1/files/${FILE_ID}`)
      })
  })

  it('DELETE /v1/files/:fileId — delete a file', async () => {
    await fileStorage
      .given('file exists with id ' + FILE_ID)
      .uponReceiving('a delete file request')
      .withRequest({
        method: 'DELETE',
        path: `/v1/files/${FILE_ID}`,
        query: { userId: USER_ID },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        stub.targetUrl = mockserver.url
        const res = await request(app.getHttpServer()).delete(`/api/v1/files/${FILE_ID}`)
        expect(res.status).toBe(204)
      })
  })

  it('POST /v1/files — upload file (cascade happy path)', async () => {
    let cascadeVerified = false
    stub.interceptFn = (_serviceUrl, opts) => {
      if (opts.method === 'POST' && opts.path === 'v1/files') {
        return {
          status: 201,
          data: {
            id: FILE_ID,
            userId: USER_ID,
            storageKey: `${USER_ID}/${FILE_ID}.png`,
            originalName: 'photo.png',
            mimeType: 'image/png',
            sizeBytes: 16,
            checksumSha256: 'abc123def456',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        }
      }
      if (opts.method === 'GET' && opts.path.startsWith('v1/assets/by-file/')) {
        return { status: 404, data: { message: 'Asset not found' } }
      }
      if (opts.method === 'POST' && opts.path === 'v1/assets') {
        cascadeVerified = true
        return {
          status: 201,
          data: {
            id: ASSET_ID,
            userId: USER_ID,
            fileId: FILE_ID,
            kind: 'photo',
            uploadedAt: '2024-01-01T00:00:00.000Z',
            isTrashed: false,
            trashedAt: null,
            title: null,
            description: null,
            takenAt: null,
            favorite: false,
            mimeType: null,
            sizeBytes: null,
            originalName: null,
            width: null,
            height: null,
            durationSeconds: null,
            cameraMake: null,
            cameraModel: null,
            orientation: null,
            latitude: null,
            longitude: null,
            fps: null,
            codec: null,
            hasAudio: null,
            metadataStatus: 'pending',
            metadataExtractedAt: null,
          },
        }
      }
      return null
    }
    const res = await request(app.getHttpServer())
      .post('/api/v1/files')
      .attach('file', Buffer.from('test-image-data'), 'photo.png')
      .field('kind', 'photo')
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(ASSET_ID)
    expect(cascadeVerified).toBe(true)
    expect(stub.calls.some((c) => c.path.startsWith('v1/assets/by-file/'))).toBe(true)
    expect(stub.calls.some((c) => c.method === 'POST' && c.path === 'v1/assets')).toBe(true)
  })

  it('GET /v1/files/:fileId/download — download a file', async () => {
    await fileStorage
      .given('file exists with id ' + FILE_ID)
      .uponReceiving('a request to download a file')
      .withRequest({
        method: 'GET',
        path: `/v1/files/${FILE_ID}/download`,
        query: { userId: USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': MatchersV3.string('image/png'),
          'Content-Disposition': MatchersV3.string('attachment; filename="photo.png"'),
        },
      })
      .executeTest(async (mockserver) => {
        const originalUrl = (SERVICE_URLS as Record<string, string>)['file-storage-service']!
        ;(SERVICE_URLS as Record<string, string>)['file-storage-service'] = mockserver.url
        try {
          const res = await request(app.getHttpServer()).get(`/api/v1/files/${FILE_ID}/download`)
          expect(res.status).toBe(200)
          expect(res.headers['content-type']).toContain('image/png')
        } finally {
          ;(SERVICE_URLS as Record<string, string>)['file-storage-service'] = originalUrl
        }
      })
  })
})
