import path from 'node:path'
import { PactV3, MatchersV3 } from '@pact-foundation/pact'

vi.mock('../../../src/store/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      accessToken: 'pact-test-token',
      refresh: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

import { api } from '../../../src/api/client'
import { login, register, refresh, logout } from '../../../src/api/auth'
import { listAssets, getAsset } from '../../../src/api/assets'

const PACT_DIR = path.resolve(__dirname, '../../../../../pacts')
const provider = new PactV3({
  dir: PACT_DIR,
  consumer: 'web',
  provider: 'gateway',
  logLevel: 'error',
})

const authResponse = {
  accessToken: MatchersV3.string('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.token'),
  refreshToken: MatchersV3.string('valid-refresh-token'),
  user: {
    id: MatchersV3.uuid('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    email: MatchersV3.string('user@test.com'),
    displayName: MatchersV3.string('Test User'),
    createdAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
    updatedAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
  },
}

const minimalAsset = MatchersV3.like({
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  kind: 'photo',
  fileId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  uploadedAt: '2024-01-01T00:00:00.000Z',
  isTrashed: false,
  trashedAt: null,
  title: null,
  description: null,
  takenAt: null,
  favorite: false,
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
  originalName: 'photo.jpg',
  width: 1920,
  height: 1080,
  durationSeconds: null,
  cameraMake: null,
  cameraModel: null,
  lensModel: null,
  orientation: null,
  iso: null,
  fNumber: null,
  exposureTime: null,
  focalLength: null,
  latitude: null,
  longitude: null,
  altitude: null,
  fps: null,
  codec: null,
  hasAudio: null,
  metadata: null,
  metadataStatus: 'ready',
  metadataExtractedAt: null,
  transcodeStatus: 'ready',
  transcodeFileId: null,
  thumbnailStatus: 'ready',
  faceStatus: null,
  faceCount: null,
})

describe('Web → Gateway pact', () => {
  it('POST /api/v1/auth/login — happy path', async () => {
    await provider
      .uponReceiving('a login request')
      .withRequest({
        method: 'POST',
        path: '/api/v1/auth/login',
        headers: { 'Content-Type': 'application/json' },
        body: { email: 'user@test.com', password: 'ValidPass123' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: authResponse,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await login({ email: 'user@test.com', password: 'ValidPass123' })
        expect(res.accessToken).toBeTruthy()
        expect(res.user.email).toBe('user@test.com')
      })
  })

  it('POST /api/v1/auth/register — happy path', async () => {
    await provider
      .uponReceiving('a register request')
      .withRequest({
        method: 'POST',
        path: '/api/v1/auth/register',
        headers: { 'Content-Type': 'application/json' },
        body: { email: 'new@test.com', password: 'ValidPass123', displayName: 'New User' },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: authResponse,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await register({
          email: 'new@test.com',
          password: 'ValidPass123',
          displayName: 'New User',
        })
        expect(res.accessToken).toBeTruthy()
      })
  })

  it('POST /api/v1/auth/refresh — happy path', async () => {
    await provider
      .uponReceiving('a refresh request')
      .withRequest({
        method: 'POST',
        path: '/api/v1/auth/refresh',
        headers: { 'Content-Type': 'application/json' },
        body: { refreshToken: 'valid-refresh-token' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: authResponse,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await refresh('valid-refresh-token')
        expect(res.accessToken).toBeTruthy()
      })
  })

  it('POST /api/v1/auth/logout — happy path', async () => {
    await provider
      .uponReceiving('a logout request')
      .withRequest({
        method: 'POST',
        path: '/api/v1/auth/logout',
        headers: { 'Content-Type': 'application/json' },
        body: { refreshToken: 'valid-refresh-token' },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await logout('valid-refresh-token')
      })
  })

  it('GET /api/v1/assets — list assets', async () => {
    await provider
      .uponReceiving('a request to list assets')
      .withRequest({
        method: 'GET',
        path: '/api/v1/assets',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          items: MatchersV3.eachLike({
            id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            kind: 'photo',
            fileId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
            isTrashed: false,
            favorite: false,
            thumbnailStatus: 'ready',
          }),
          total: 1,
          limit: 20,
          offset: 0,
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await listAssets({})
        expect(res.items.length).toBeGreaterThan(0)
        expect(res.total).toBe(1)
      })
  })

  it('GET /api/v1/assets/:id — get single asset', async () => {
    await provider
      .uponReceiving('a request to get a single asset')
      .withRequest({
        method: 'GET',
        path: '/api/v1/assets/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: minimalAsset,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await getAsset('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        expect(res.id).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
      })
  })
})
