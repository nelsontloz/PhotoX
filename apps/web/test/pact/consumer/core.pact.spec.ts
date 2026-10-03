import path from 'node:path'
import { PactV3, MatchersV3 } from '@pact-foundation/pact'
import type { AdminLibraryStatsResponse } from '@photox/shared-types'

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
import {
  listAssets,
  getAsset,
  getAssetLayout,
  uploadFile,
  updateAsset,
  trashAsset,
  restoreAsset,
  deleteAsset,
  emptyTrash,
  trashAssets,
  getVideoStreamUrl,
  reprocessThumbnails as reprocessAssetThumbnails,
  reprocessVideo,
} from '../../../src/api/assets'
import { searchAssets } from '../../../src/api/search'
import { getAssetDetections } from '../../../src/api/detections'
import { createShare, listShares, revokeShare } from '../../../src/api/shares'
import {
  listAlbums,
  getAlbum,
  createAlbum,
  updateAlbum,
  deleteAlbum,
  listAlbumAssets,
  addAssetsToAlbum,
  removeAssetFromAlbum,
} from '../../../src/api/albums'
import {
  listPersons,
  getPerson,
  renamePerson,
  getPersonAssets,
  triggerCluster,
} from '../../../src/api/persons'
import { downloadFaceThumb, assignFace } from '../../../src/api/faces'
import {
  listAdminUsers,
  getAdminAssetCounts,
  reprocessThumbnails,
  cleanupOrphans,
  getOrphanCounts,
  getFaceDetection,
  setFaceDetector,
  reprocessFaces,
  getFaceReprocessStatus,
  reclusterFaces,
} from '../../../src/api/admin'

const PACT_DIR = path.resolve(__dirname, '../../../../../pacts')
const provider = new PactV3({
  dir: PACT_DIR,
  consumer: 'web',
  provider: 'core',
  logLevel: 'error',
})

const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const FILE_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const ALBUM_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
const SHARE_ID = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44'
const PERSON_ID = 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55'
const FACE_ID = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66'

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

const assetListResponse = MatchersV3.like({
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
})

const searchResponse = MatchersV3.like({
  items: MatchersV3.eachLike({
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    kind: 'photo',
    fileId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    isTrashed: false,
    favorite: false,
    thumbnailStatus: 'ready',
  }),
  total: 1,
})

const albumDto = MatchersV3.like({
  id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  name: 'Trip 2024',
  description: null,
  assetCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
})

const shareDto = MatchersV3.like({
  id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
  kind: 'asset',
  assetId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  token: 'valid-share-token',
  assetFileId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  assetThumbFileId: null,
  assetKind: 'photo',
  createdAt: '2024-01-01T00:00:00.000Z',
})

const albumShareDto = MatchersV3.like({
  id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a45',
  kind: 'album',
  userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  token: 'valid-album-share-token',
  albumId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  albumName: 'Trip 2024',
  albumAssetCount: 1,
  albumCoverThumbFileId: null,
  createdAt: '2024-01-01T00:00:00.000Z',
})

const publicAssetDto = MatchersV3.like({
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  kind: 'photo',
  fileId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  title: null,
  originalName: 'photo.jpg',
  mimeType: 'image/jpeg',
  width: 1920,
  height: 1080,
  durationSeconds: null,
  takenAt: null,
})

const personDto = MatchersV3.like({
  id: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
  userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  name: 'Ada',
  coverFaceId: null,
  coverFaceUrl: null,
  clusterLabel: 'cluster-1',
  faceCount: 2,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
})

const personListResponse = MatchersV3.like({
  items: MatchersV3.eachLike({
    id: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
    userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    name: 'Ada',
    coverFaceId: null,
    coverFaceUrl: null,
    clusterLabel: 'cluster-1',
    faceCount: 2,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }),
  total: 1,
  limit: 20,
  offset: 0,
})

const errorResponse = (status: number, message: string) =>
  MatchersV3.like({
    statusCode: status,
    message,
    error: status === 404 ? 'Not Found' : 'Error',
  })

describe('Web → Core pact', () => {
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
        body: assetListResponse,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await listAssets({})
        expect(res.items.length).toBeGreaterThan(0)
        expect(res.total).toBe(1)
      })
  })

  it('GET /api/v1/assets — list assets within a date range', async () => {
    const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    const dateFrom = '2026-06-01T00:00:00.000Z'
    const dateTo = '2026-07-01T00:00:00.000Z'
    await provider
      .uponReceiving('a request to list assets within a date range')
      .withRequest({
        method: 'GET',
        path: '/api/v1/assets',
        query: {
          limit: '50',
          offset: '0',
          dateFrom: MatchersV3.regex(ISO_INSTANT, dateFrom),
          dateTo: MatchersV3.regex(ISO_INSTANT, dateTo),
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: assetListResponse,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await listAssets({ limit: 50, offset: 0, dateFrom, dateTo })
        expect(res.items.length).toBeGreaterThan(0)
      })
  })

  it('GET /api/v1/search — search assets', async () => {
    await provider
      .uponReceiving('a request to search assets')
      .withRequest({
        method: 'GET',
        path: '/api/v1/search',
        query: { q: 'beach', limit: '50', offset: '0' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: searchResponse,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await searchAssets({ q: 'beach', limit: 50, offset: 0 })
        expect(res.items.length).toBeGreaterThan(0)
        expect(res.total).toBe(1)
      })
  })

  it('GET /api/v1/assets/layout — compact timeline layout', async () => {
    await provider
      .uponReceiving('a request to get the asset layout')
      .withRequest({
        method: 'GET',
        path: '/api/v1/assets/layout',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          items: [
            { t: '2025-12-25T10:11:12.000Z', w: 4032, h: 3024 },
            { t: '2025-12-24T09:00:00.000Z', w: 1, h: 1 },
          ],
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await getAssetLayout()
        expect(res.items.length).toBe(2)
        expect(res.items[1]?.w).toBe(1)
        expect(res.items[1]?.h).toBe(1)
      })
  })

  it('GET /api/v1/assets/:id — get single asset', async () => {
    await provider
      .uponReceiving('a request to get a single asset')
      .withRequest({
        method: 'GET',
        path: `/api/v1/assets/${ASSET_ID}`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: minimalAsset,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await getAsset(ASSET_ID)
        expect(res.id).toBe(ASSET_ID)
      })
  })

  it('GET /api/v1/assets/trashed — list trashed assets', async () => {
    await provider
      .uponReceiving('a request to list trashed assets')
      .withRequest({
        method: 'GET',
        path: '/api/v1/assets/trashed',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: assetListResponse,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await listAssets({ isTrashed: true })
        expect(res.items.length).toBeGreaterThan(0)
        expect(res.limit).toBe(20)
      })
  })

  it('GET /api/v1/files/:fileId/stream — video stream URL', async () => {
    await provider
      .uponReceiving('a request to stream a video file')
      .withRequest({
        method: 'GET',
        path: `/api/v1/files/${FILE_ID}/stream`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        // <video src> consumes the URL builder directly; re-issue it through the client for the pact
        const url = getVideoStreamUrl(FILE_ID)
        const res = await api.get(url.replace(/^\/api/, ''), { responseType: 'arraybuffer' })
        expect(res.status).toBe(200)
      })
  })

  it('POST /api/v1/files — upload an asset', async () => {
    await provider
      .uponReceiving('a file upload request')
      .withRequest({
        method: 'POST',
        path: '/api/v1/files',
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: minimalAsset,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const file = new File(['photo-bytes'], 'photo.jpg', { type: 'image/jpeg' })
        const res = await uploadFile(file, undefined, 'photo', 'My photo')
        expect(res.id).toBe(ASSET_ID)
      })
  })

  it('PATCH /api/v1/assets/:id — update editable fields', async () => {
    await provider
      .uponReceiving('a request to update an asset')
      .withRequest({
        method: 'PATCH',
        path: `/api/v1/assets/${ASSET_ID}`,
        headers: { 'Content-Type': 'application/json' },
        body: { favorite: true },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: minimalAsset,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await updateAsset(ASSET_ID, { favorite: true })
        expect(res.id).toBe(ASSET_ID)
      })
  })

  it('POST /api/v1/assets/:id/trash — soft-delete an asset', async () => {
    await provider
      .uponReceiving('a request to trash an asset')
      .withRequest({
        method: 'POST',
        path: `/api/v1/assets/${ASSET_ID}/trash`,
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await trashAsset(ASSET_ID)
      })
  })

  it('POST /api/v1/assets/bulk-trash — soft-delete several assets', async () => {
    await provider
      .uponReceiving('a request to bulk trash assets')
      .withRequest({
        method: 'POST',
        path: '/api/v1/assets/bulk-trash',
        headers: { 'Content-Type': 'application/json' },
        body: { assetIds: [ASSET_ID] },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await trashAssets([ASSET_ID])
      })
  })

  it('POST /api/v1/assets/trashed/:id/restore — restore an asset', async () => {
    await provider
      .uponReceiving('a request to restore a trashed asset')
      .withRequest({
        method: 'POST',
        path: `/api/v1/assets/trashed/${ASSET_ID}/restore`,
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await restoreAsset(ASSET_ID)
      })
  })

  it('DELETE /api/v1/assets/trashed/:id — permanently delete an asset', async () => {
    await provider
      .uponReceiving('a request to permanently delete a trashed asset')
      .withRequest({
        method: 'DELETE',
        path: `/api/v1/assets/trashed/${ASSET_ID}`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({ fileIds: [FILE_ID] }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await deleteAsset(ASSET_ID)
      })
  })

  it('DELETE /api/v1/assets/trashed — empty the trash', async () => {
    await provider
      .uponReceiving('a request to empty the trash')
      .withRequest({
        method: 'DELETE',
        path: '/api/v1/assets/trashed',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({ fileIds: [FILE_ID] }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await emptyTrash()
      })
  })

  it('POST /api/v1/shares — create a share link', async () => {
    await provider
      .uponReceiving('a request to create a share')
      .withRequest({
        method: 'POST',
        path: '/api/v1/shares',
        headers: { 'Content-Type': 'application/json' },
        body: { assetId: ASSET_ID },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: shareDto,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await createShare({ assetId: ASSET_ID })
        expect(res.token).toBe('valid-share-token')
      })
  })

  it('GET /api/v1/shares — list share links including an album', async () => {
    await provider
      .uponReceiving('a request to list shares including an album')
      .withRequest({
        method: 'GET',
        path: '/api/v1/shares',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          items: [
            MatchersV3.like({
              id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
              kind: 'asset',
              assetId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
              token: 'valid-share-token',
              assetKind: 'photo',
              createdAt: '2024-01-02T00:00:00.000Z',
            }),
            MatchersV3.like({
              id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a45',
              kind: 'album',
              albumId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
              albumName: 'Trip 2024',
              albumAssetCount: 1,
              token: 'valid-album-share-token',
              createdAt: '2024-01-01T00:00:00.000Z',
            }),
          ],
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await listShares()
        expect(res.items.map((item) => item.kind)).toEqual(['asset', 'album'])
      })
  })

  it('DELETE /api/v1/shares/:shareId — revoke a share link', async () => {
    await provider
      .uponReceiving('a request to revoke a share')
      .withRequest({
        method: 'DELETE',
        path: `/api/v1/shares/${SHARE_ID}`,
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await revokeShare(SHARE_ID)
      })
  })

  it('GET /api/share/:token — resolve a public share', async () => {
    await provider
      .uponReceiving('a request to resolve a public share')
      .withRequest({
        method: 'GET',
        path: '/api/share/valid-share-token',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          kind: 'asset',
          share: {
            id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
            kind: 'asset',
            assetId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            token: 'valid-share-token',
            assetFileId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
            assetThumbFileId: null,
            assetKind: 'photo',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
          asset: {
            id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            kind: 'photo',
            fileId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
            title: null,
            originalName: 'photo.jpg',
            mimeType: 'image/jpeg',
            width: 1920,
            height: 1080,
            durationSeconds: null,
            takenAt: null,
          },
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const { data } = await api.get('/share/valid-share-token')
        expect(data.share.token).toBe('valid-share-token')
        expect(data.asset.kind).toBe('photo')
      })
  })

  it('GET /api/share/:token — revoked token returns 404', async () => {
    await provider
      .uponReceiving('a request for a revoked public share')
      .withRequest({
        method: 'GET',
        path: '/api/share/revoked-share-token',
      })
      .willRespondWith({
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: errorResponse(404, 'Share not found'),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await expect(api.get('/share/revoked-share-token')).rejects.toMatchObject({
          response: { status: 404 },
        })
      })
  })

  it('POST /api/v1/shares — create an album share link', async () => {
    await provider
      .uponReceiving('a request to create an album share')
      .withRequest({
        method: 'POST',
        path: '/api/v1/shares',
        headers: { 'Content-Type': 'application/json' },
        body: { albumId: ALBUM_ID },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: albumShareDto,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await createShare({ albumId: ALBUM_ID })
        expect(res.kind).toBe('album')
        expect(res.token).toBe('valid-album-share-token')
      })
  })

  it('GET /api/share/:token — resolve a public album share', async () => {
    await provider
      .uponReceiving('a request to resolve a public album share')
      .withRequest({
        method: 'GET',
        path: '/api/share/valid-album-share-token',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          kind: 'album',
          share: {
            id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a45',
            kind: 'album',
            userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            token: 'valid-album-share-token',
            albumId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
            albumName: 'Trip 2024',
            albumAssetCount: 1,
            albumCoverThumbFileId: null,
            createdAt: '2024-01-01T00:00:00.000Z',
          },
          album: {
            id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
            name: 'Trip 2024',
            description: null,
            assetCount: 1,
          },
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const { data } = await api.get('/share/valid-album-share-token')
        expect(data.kind).toBe('album')
        expect(data.album.id).toBe(ALBUM_ID)
      })
  })

  it('GET /api/share/:token/assets — list public album assets', async () => {
    await provider
      .uponReceiving('a request to list the assets of a public album share')
      .withRequest({
        method: 'GET',
        path: '/api/share/valid-album-share-token/assets',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          items: MatchersV3.eachLike(publicAssetDto),
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const { data } = await api.get('/share/valid-album-share-token/assets')
        expect(data.items.length).toBeGreaterThan(0)
        expect(data.items[0].kind).toBe('photo')
      })
  })

  it('GET /api/v1/albums — list albums', async () => {
    await provider
      .uponReceiving('a request to list albums')
      .withRequest({
        method: 'GET',
        path: '/api/v1/albums',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          items: MatchersV3.eachLike({
            id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
            userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            name: 'Trip 2024',
            description: null,
            assetCount: 0,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          }),
          total: 1,
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await listAlbums()
        expect(res.items.length).toBeGreaterThan(0)
      })
  })

  it('POST /api/v1/albums — create an album', async () => {
    await provider
      .uponReceiving('a request to create an album')
      .withRequest({
        method: 'POST',
        path: '/api/v1/albums',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Trip 2024' },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: albumDto,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await createAlbum({ name: 'Trip 2024' })
        expect(res.name).toBe('Trip 2024')
      })
  })

  it('GET /api/v1/albums/:id — get an album', async () => {
    await provider
      .uponReceiving('a request to get a single album')
      .withRequest({
        method: 'GET',
        path: `/api/v1/albums/${ALBUM_ID}`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: albumDto,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await getAlbum(ALBUM_ID)
        expect(res.id).toBe(ALBUM_ID)
      })
  })

  it('PATCH /api/v1/albums/:id — update an album', async () => {
    await provider
      .uponReceiving('a request to update an album')
      .withRequest({
        method: 'PATCH',
        path: `/api/v1/albums/${ALBUM_ID}`,
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Trip 2025' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: albumDto,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await updateAlbum(ALBUM_ID, { name: 'Trip 2025' })
        expect(res.id).toBe(ALBUM_ID)
      })
  })

  it('DELETE /api/v1/albums/:id — delete an album', async () => {
    await provider
      .uponReceiving('a request to delete an album')
      .withRequest({
        method: 'DELETE',
        path: `/api/v1/albums/${ALBUM_ID}`,
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await deleteAlbum(ALBUM_ID)
      })
  })

  it('GET /api/v1/albums/:id/assets — list album assets', async () => {
    await provider
      .uponReceiving('a request to list assets in an album')
      .withRequest({
        method: 'GET',
        path: `/api/v1/albums/${ALBUM_ID}/assets`,
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
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await listAlbumAssets(ALBUM_ID)
        expect(res.items.length).toBeGreaterThan(0)
      })
  })

  it('POST /api/v1/albums/:id/assets — add assets to an album', async () => {
    await provider
      .uponReceiving('a request to add assets to an album')
      .withRequest({
        method: 'POST',
        path: `/api/v1/albums/${ALBUM_ID}/assets`,
        headers: { 'Content-Type': 'application/json' },
        body: { assetIds: [ASSET_ID] },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({ added: 1 }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await addAssetsToAlbum(ALBUM_ID, [ASSET_ID])
        expect(res.added).toBe(1)
      })
  })

  it('DELETE /api/v1/albums/:id/assets/:assetId — remove an asset from an album', async () => {
    await provider
      .uponReceiving('a request to remove an asset from an album')
      .withRequest({
        method: 'DELETE',
        path: `/api/v1/albums/${ALBUM_ID}/assets/${ASSET_ID}`,
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await removeAssetFromAlbum(ALBUM_ID, ASSET_ID)
      })
  })

  it('GET /api/v1/persons — list persons', async () => {
    await provider
      .uponReceiving('a request to list persons')
      .withRequest({
        method: 'GET',
        path: '/api/v1/persons',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: personListResponse,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await listPersons()
        expect(res.items.length).toBeGreaterThan(0)
      })
  })

  it('GET /api/v1/persons/:id — get a person', async () => {
    await provider
      .uponReceiving('a request to get a single person')
      .withRequest({
        method: 'GET',
        path: `/api/v1/persons/${PERSON_ID}`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: personDto,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await getPerson(PERSON_ID)
        expect(res.id).toBe(PERSON_ID)
      })
  })

  it('PATCH /api/v1/persons/:id — rename a person', async () => {
    await provider
      .uponReceiving('a request to rename a person')
      .withRequest({
        method: 'PATCH',
        path: `/api/v1/persons/${PERSON_ID}`,
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Ada' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: personDto,
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await renamePerson(PERSON_ID, 'Ada')
        expect(res.name).toBe('Ada')
      })
  })

  it('GET /api/v1/persons/:id/assets — list a person’s assets', async () => {
    await provider
      .uponReceiving('a request to list a person’s assets')
      .withRequest({
        method: 'GET',
        path: `/api/v1/persons/${PERSON_ID}/assets`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          personId: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
          items: MatchersV3.eachLike({
            assetId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            faceId: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
            uploadedAt: '2024-01-01T00:00:00.000Z',
            faceCount: 1,
          }),
          total: 1,
          limit: 20,
          offset: 0,
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await getPersonAssets(PERSON_ID)
        expect(res.personId).toBe(PERSON_ID)
        expect(res.items.length).toBeGreaterThan(0)
      })
  })

  it('POST /api/v1/persons/cluster — trigger clustering', async () => {
    await provider
      .uponReceiving('a request to trigger face clustering')
      .withRequest({
        method: 'POST',
        path: '/api/v1/persons/cluster',
      })
      .willRespondWith({
        status: 202,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({ queued: true, jobId: 'cluster-a0eebc99-manual-1700000000000' }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await triggerCluster()
        expect(res.queued).toBe(true)
      })
  })

  it('GET /api/v1/faces/:faceId/thumb — fetch a face crop', async () => {
    await provider
      .uponReceiving('a request for a face thumbnail')
      .withRequest({
        method: 'GET',
        path: `/api/v1/faces/${FACE_ID}/thumb`,
        query: { size: '128' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await downloadFaceThumb(FACE_ID, 128)
        expect(res).toBeInstanceOf(Blob)
      })
  })

  it('PATCH /api/v1/faces/:faceId/person — assign a face to a person', async () => {
    await provider
      .uponReceiving('a request to assign a face to a person')
      .withRequest({
        method: 'PATCH',
        path: `/api/v1/faces/${FACE_ID}/person`,
        headers: { 'Content-Type': 'application/json' },
        body: { personId: PERSON_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({ ok: true }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await assignFace(FACE_ID, PERSON_ID)
      })
  })

  it('GET /api/v1/admin/users — list users', async () => {
    await provider
      .uponReceiving('a request to list admin users')
      .withRequest({
        method: 'GET',
        path: '/api/v1/admin/users',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          items: MatchersV3.eachLike({
            id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            displayName: 'Test User',
            email: 'user@test.com',
            role: 'user',
            createdAt: '2024-01-01T00:00:00.000Z',
          }),
          total: 1,
          limit: 20,
          offset: 0,
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await listAdminUsers()
        expect(res.items.length).toBeGreaterThan(0)
      })
  })

  it('GET /api/v1/admin/assets/counts — asset failure counts', async () => {
    await provider
      .uponReceiving('a request for admin asset counts')
      .withRequest({
        method: 'GET',
        path: '/api/v1/admin/assets/counts',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          photos: { processing: 0, metadata: 0, thumbnails: 0, encoding: 0 },
          videos: { processing: 0, metadata: 0, thumbnails: 0, encoding: 0 },
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await getAdminAssetCounts()
        expect(res.photos.thumbnails).toBe(0)
      })
  })

  it('GET /api/v1/admin/assets/stats — library stats', async () => {
    await provider
      .uponReceiving('a request for admin library stats')
      .withRequest({
        method: 'GET',
        path: '/api/v1/admin/assets/stats',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          counts: { photos: 12, videos: 3, trashed: 1 },
          uploadsByWeek: MatchersV3.eachLike({
            week: '2026-09-28',
            photos: 4,
            videos: 1,
          }),
          storageByMonth: MatchersV3.eachLike({
            month: '2026-09-01',
            originalsBytes: 123456,
            transcodesBytes: 23456,
            thumbnailsBytes: 3456,
          }),
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const { data } = await api.get<AdminLibraryStatsResponse>('/v1/admin/assets/stats')
        expect(data.counts.photos).toBeGreaterThan(0)
      })
  })

  it('POST /api/v1/admin/thumbnails/reprocess — reprocess thumbnails', async () => {
    await provider
      .uponReceiving('a request to reprocess all thumbnails')
      .withRequest({
        method: 'POST',
        path: '/api/v1/admin/thumbnails/reprocess',
        headers: { 'Content-Type': 'application/json' },
        body: { kind: 'photo' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({ enqueued: 4, totalAssets: 1 }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await reprocessThumbnails('photo')
        expect(res.totalAssets).toBe(1)
      })
  })

  it('POST /api/v1/admin/cleanup-orphans — enqueue orphan cleanup', async () => {
    await provider
      .uponReceiving('a request to enqueue orphan cleanup')
      .withRequest({
        method: 'POST',
        path: '/api/v1/admin/cleanup-orphans',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({ enqueued: true }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await cleanupOrphans()
        expect(res.enqueued).toBe(true)
      })
  })

  it('GET /api/v1/admin/orphan-counts — orphan counts', async () => {
    await provider
      .uponReceiving('a request for admin orphan counts')
      .withRequest({
        method: 'GET',
        path: '/api/v1/admin/orphan-counts',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({ orphanFiles: 0, orphanThumbnails: 0 }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await getOrphanCounts()
        expect(res.orphanFiles).toBe(0)
      })
  })

  it('GET /api/v1/admin/face-detection — face detector settings', async () => {
    await provider
      .uponReceiving('a request for admin face detection settings')
      .withRequest({
        method: 'GET',
        path: '/api/v1/admin/face-detection',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          detector: 'human',
          envDefault: 'human',
          models: { scrfd: false },
          facesByDetector: { human: 3, scrfd: 2, unset: 1 },
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await getFaceDetection()
        expect(res.detector).toBe('human')
        expect(res.facesByDetector.unset).toBe(1)
      })
  })

  it('PUT /api/v1/admin/face-detection — switch the detector', async () => {
    await provider
      .uponReceiving('a request to switch the admin face detector')
      .withRequest({
        method: 'PUT',
        path: '/api/v1/admin/face-detection',
        headers: { 'Content-Type': 'application/json' },
        body: { detector: 'scrfd' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          detector: 'scrfd',
          envDefault: 'human',
          models: { scrfd: true },
          facesByDetector: { human: 3, scrfd: 2, unset: 1 },
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await setFaceDetector('scrfd')
        expect(res.detector).toBe('scrfd')
      })
  })

  it('POST /api/v1/admin/faces/reprocess — enqueue face reprocess', async () => {
    await provider
      .uponReceiving('a request to reprocess all faces')
      .withRequest({
        method: 'POST',
        path: '/api/v1/admin/faces/reprocess',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({ enqueued: 5, total: 5, detector: 'human' }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await reprocessFaces()
        expect(res.enqueued).toBe(5)
      })
  })

  it('GET /api/v1/admin/faces/reprocess — last run and queue counts', async () => {
    await provider
      .uponReceiving('a request for the face reprocess status')
      .withRequest({
        method: 'GET',
        path: '/api/v1/admin/faces/reprocess',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        // ponytail: pact-js has no nullable/oneOf matcher (open feature request), and lastRun is
        // legitimately null on fresh state — leave it out of the expected body so verification
        // accepts both null and the run object (unexpected response keys are allowed by default).
        // Ceiling: add a real oneOf matcher if/when pact-js ships one.
        body: MatchersV3.like({
          queue: { waiting: 1, active: 1, completed: 3, failed: 0, delayed: 0 },
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await getFaceReprocessStatus()
        expect(res.queue.waiting).toBe(1)
      })
  })

  it('POST /api/v1/admin/faces/recluster — enqueue manual clustering', async () => {
    await provider
      .uponReceiving('a request to recluster faces manually')
      .withRequest({
        method: 'POST',
        path: '/api/v1/admin/faces/recluster',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({ enqueued: 2 }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await reclusterFaces()
        expect(res.enqueued).toBe(2)
      })
  })

  it('POST /api/v1/assets/:id/reprocess-thumbnails — reprocess asset thumbnails', async () => {
    await provider
      .uponReceiving('a request to reprocess the thumbnails of an asset')
      .withRequest({
        method: 'POST',
        path: `/api/v1/assets/${ASSET_ID}/reprocess-thumbnails`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({ enqueued: 4 }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await reprocessAssetThumbnails(ASSET_ID)
      })
  })

  it('POST /api/v1/assets/:id/reprocess-video — reprocess asset video', async () => {
    await provider
      .uponReceiving('a request to reprocess the video of an asset')
      .withRequest({
        method: 'POST',
        path: `/api/v1/assets/${ASSET_ID}/reprocess-video`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({ enqueued: 1 }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        await reprocessVideo(ASSET_ID)
      })
  })

  it('GET /api/v1/assets/:id/detections — list detected objects', async () => {
    await provider
      .uponReceiving('a request to list the detected objects of an asset')
      .withRequest({
        method: 'GET',
        path: `/api/v1/assets/${ASSET_ID}/detections`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          detections: MatchersV3.eachLike({
            label: 'dog',
            confidence: 0.9,
            box: { x: 10, y: 20, w: 100, h: 80 },
          }),
        }),
      })
      .executeTest(async (mockserver) => {
        api.defaults.baseURL = mockserver.url + '/api'
        const res = await getAssetDetections(ASSET_ID)
        expect(res.detections.length).toBeGreaterThan(0)
        expect(res.detections[0]?.label).toBe('dog')
      })
  })
})
