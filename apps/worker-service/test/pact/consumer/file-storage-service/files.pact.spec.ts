/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MatchersV3 } from '@pact-foundation/pact'
import axios from 'axios'
import FormData from 'form-data'
import { createPact } from '../setup'

// Minimal 1x1 white WebP — used so Pact detects the file as image/webp by magic bytes (RIFF....WEBP)
const WEBP_DATA = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  0x18, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x01, 0x40,
  0x26, 0x25, 0xa4, 0x00, 0x03, 0x70, 0x00, 0xfe, 0xfc, 0xf4, 0x00, 0x00,
])

const fileStorage = createPact('file-storage-service')

const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'
const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

const fileRecordMatcher = {
  id: MatchersV3.uuid(FILE_ID),
  userId: MatchersV3.uuid(USER_ID),
  storageKey: MatchersV3.string(`${USER_ID}/${FILE_ID}.png`),
  originalName: MatchersV3.string('thumb-sm.webp'),
  mimeType: MatchersV3.string('image/webp'),
  sizeBytes: MatchersV3.integer(12345),
  checksumSha256: MatchersV3.string('abc123def456'),
  createdAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
}

describe('Worker → file-storage-service files pact', () => {
  it('GET /v1/files/:fileId/stream — stream file (happy path)', async () => {
    await fileStorage
      .given('file exists with id ' + FILE_ID)
      .uponReceiving('a request to stream a file')
      .withRequest({
        method: 'GET',
        path: `/v1/files/${FILE_ID}/stream`,
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': MatchersV3.string(`attachment; filename="photo.jpg"`),
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.get(`${mockserver.url}/v1/files/${FILE_ID}/stream`, {
          responseType: 'arraybuffer',
        })
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toBe('image/png')
        expect(Buffer.isBuffer(res.data) || res.data).toBeTruthy()
      })
  })

  it('GET /v1/files/:fileId/stream — file not found', async () => {
    await fileStorage
      .given('file does not exist')
      .uponReceiving('a request to stream a missing file')
      .withRequest({
        method: 'GET',
        path: `/v1/files/${FILE_ID}/stream`,
      })
      .willRespondWith({
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          message: MatchersV3.string('File not found'),
        }),
      })
      .executeTest(async (mockserver) => {
        try {
          await axios.get(`${mockserver.url}/v1/files/${FILE_ID}/stream`)
        } catch (err: unknown) {
          if (axios.isAxiosError(err) && err.response) {
            expect(err.response.status).toBe(404)
            expect(err.response.data.message).toBeTruthy()
          } else {
            throw err
          }
        }
      })
  })

  it('POST /v1/files — upload file (happy path)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pact-'))
    const tmpFile = join(tmpDir, 'thumb-sm.webp')
    writeFileSync(tmpFile, WEBP_DATA)

    await fileStorage
      .given('user can upload a file')
      .uponReceiving('a request to upload a file')
      .withRequestMultipartFileUpload(
        {
          method: 'POST',
          path: '/v1/files',
        },
        'image/webp',
        tmpFile,
        'file',
      )
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: fileRecordMatcher,
      })
      .executeTest(async (mockserver) => {
        const form = new FormData()
        form.append('file', WEBP_DATA, {
          filename: 'thumb-sm.webp',
          contentType: 'image/webp',
        })
        form.append('userId', USER_ID)

        const res = await axios.post(`${mockserver.url}/v1/files`, form, {
          headers: form.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        })
        expect(res.status).toBe(201)
        expect(res.data.id).toBe(FILE_ID)
        expect(res.data.mimeType).toBe('image/webp')
      })
  })

  it('GET /v1/files/:fileId/url — get presigned URL (worker downloads source)', async () => {
    await fileStorage
      .given('file exists with id ' + FILE_ID)
      .uponReceiving('a request to get a presigned URL for transcoding')
      .withRequest({
        method: 'GET',
        path: `/v1/files/${FILE_ID}/url`,
        query: { userId: USER_ID, ttl: '600' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          url: MatchersV3.string(
            `http://minio.local/${USER_ID}/${FILE_ID}.png?X-Amz-Signature=fake`,
          ),
          expiresAt: MatchersV3.integer(Date.now() + 600_000),
        }),
      })
      .executeTest(async (mockserver) => {
        const res = await axios.get(`${mockserver.url}/v1/files/${FILE_ID}/url`, {
          params: { userId: USER_ID, ttl: 600 },
        })
        expect(res.status).toBe(200)
        expect(typeof res.data.url).toBe('string')
        expect(typeof res.data.expiresAt).toBe('number')
      })
  })

  it('GET /v1/files/:fileId/url — file not found', async () => {
    const errorPact = createPact('file-storage-service')
    await errorPact
      .given('file does not exist')
      .uponReceiving('a request to get a presigned URL for a missing file')
      .withRequest({
        method: 'GET',
        path: `/v1/files/${FILE_ID}/url`,
        query: { userId: USER_ID, ttl: '600' },
      })
      .willRespondWith({
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          message: MatchersV3.string('File not found'),
        }),
      })
      .executeTest(async (mockserver) => {
        try {
          await axios.get(`${mockserver.url}/v1/files/${FILE_ID}/url`, {
            params: { userId: USER_ID, ttl: 600 },
          })
        } catch (err: unknown) {
          if (axios.isAxiosError(err) && err.response) {
            expect(err.response.status).toBe(404)
            expect(err.response.data.message).toBeTruthy()
          } else {
            throw err
          }
        }
      })
  })

  it('POST /v1/files — upload fails', async () => {
    const errorPact = createPact('file-storage-service')
    const tmpDir = mkdtempSync(join(tmpdir(), 'pact-'))
    const tmpFile = join(tmpDir, 'thumb-sm.webp')
    writeFileSync(tmpFile, WEBP_DATA)

    await errorPact
      .given('file upload fails with server error')
      .uponReceiving('a request to upload a file that fails')
      .withRequestMultipartFileUpload(
        {
          method: 'POST',
          path: '/v1/files',
        },
        'image/webp',
        tmpFile,
        'file',
      )
      .willRespondWith({
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          statusCode: 400,
          message: MatchersV3.string('Failed to upload file to storage'),
        }),
      })
      .executeTest(async (mockserver) => {
        const form = new FormData()
        form.append('file', WEBP_DATA, {
          filename: 'thumb-sm.webp',
          contentType: 'image/webp',
        })
        form.append('userId', USER_ID)

        try {
          await axios.post(`${mockserver.url}/v1/files`, form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          })
        } catch (err: unknown) {
          if (axios.isAxiosError(err) && err.response) {
            expect(err.response.status).toBe(400)
            expect(err.response.data).toBeTruthy()
          } else {
            throw err
          }
        }
      })
  })
})
