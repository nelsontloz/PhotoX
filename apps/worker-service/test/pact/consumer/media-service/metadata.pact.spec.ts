/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { MatchersV3 } from '@pact-foundation/pact'
import axios from 'axios'
import { createPact } from '../setup'

const mediaService = createPact('media-service')

const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'

const fullMetadataPatchBody = {
  status: 'ready',
  mimeType: 'image/jpeg',
  sizeBytes: 5234567,
  originalName: 'IMG_1234.HEIC',
  width: 4032,
  height: 3024,
  cameraMake: 'Apple',
  cameraModel: 'iPhone 15 Pro',
  lensModel: 'iPhone 15 Pro back triple camera 6.86mm f/1.78',
  orientation: 1,
  takenAt: '2024-06-15T14:30:00.000Z',
  latitude: 40.75,
  longitude: -73.99,
  altitude: 10.5,
  iso: 64,
  fNumber: 1.78,
  exposureTime: 0.004,
  focalLength: 6.86,
  metadata: {
    exif: {
      Make: ['Apple'],
      Model: ['iPhone 15 Pro'],
      DateTimeOriginal: ['2024:06:15 14:30:00'],
    },
  },
}

const fullMetadataResponseMatcher = {
  id: MatchersV3.uuid(ASSET_ID),
  userId: MatchersV3.uuid('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
  kind: MatchersV3.string('photo'),
  fileId: MatchersV3.uuid('550e8400-e29b-41d4-a716-446655440000'),
  uploadedAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
  isTrashed: MatchersV3.boolean(false),
  trashedAt: MatchersV3.nullValue(),
  title: MatchersV3.nullValue(),
  description: MatchersV3.nullValue(),
  takenAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-06-15T14:30:00.000Z'),
  favorite: MatchersV3.boolean(false),
  mimeType: MatchersV3.string('image/jpeg'),
  sizeBytes: MatchersV3.integer(5234567),
  originalName: MatchersV3.string('IMG_1234.HEIC'),
  width: MatchersV3.integer(4032),
  height: MatchersV3.integer(3024),
  durationSeconds: MatchersV3.nullValue(),
  cameraMake: MatchersV3.string('Apple'),
  cameraModel: MatchersV3.string('iPhone 15 Pro'),
  lensModel: MatchersV3.string('iPhone 15 Pro back triple camera 6.86mm f/1.78'),
  orientation: MatchersV3.integer(1),
  iso: MatchersV3.integer(64),
  fNumber: MatchersV3.decimal(1.78),
  exposureTime: MatchersV3.decimal(0.004),
  focalLength: MatchersV3.decimal(6.86),
  latitude: MatchersV3.decimal(40.75),
  longitude: MatchersV3.decimal(-73.99),
  altitude: MatchersV3.decimal(10.5),
  fps: MatchersV3.nullValue(),
  codec: MatchersV3.nullValue(),
  hasAudio: MatchersV3.nullValue(),
  metadata: MatchersV3.like({
    exif: MatchersV3.like({
      Make: MatchersV3.eachLike(MatchersV3.string('Apple')),
      Model: MatchersV3.eachLike(MatchersV3.string('iPhone 15 Pro')),
      DateTimeOriginal: MatchersV3.eachLike(MatchersV3.string('2024:06:15 14:30:00')),
    }),
  }),
  metadataStatus: MatchersV3.string('ready'),
  metadataExtractedAt: MatchersV3.datetime(
    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
    '2024-01-01T00:00:00.000Z',
  ),
}

const failedMetadataPatchBody = {
  status: 'failed',
}

const failedMetadataResponseMatcher = {
  id: MatchersV3.uuid(ASSET_ID),
  userId: MatchersV3.uuid('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
  kind: MatchersV3.string('photo'),
  fileId: MatchersV3.uuid('550e8400-e29b-41d4-a716-446655440000'),
  uploadedAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
  isTrashed: MatchersV3.boolean(false),
  trashedAt: MatchersV3.nullValue(),
  title: MatchersV3.nullValue(),
  description: MatchersV3.nullValue(),
  takenAt: MatchersV3.nullValue(),
  favorite: MatchersV3.boolean(false),
  mimeType: MatchersV3.nullValue(),
  sizeBytes: MatchersV3.nullValue(),
  originalName: MatchersV3.nullValue(),
  width: MatchersV3.nullValue(),
  height: MatchersV3.nullValue(),
  durationSeconds: MatchersV3.nullValue(),
  cameraMake: MatchersV3.nullValue(),
  cameraModel: MatchersV3.nullValue(),
  lensModel: MatchersV3.nullValue(),
  orientation: MatchersV3.nullValue(),
  iso: MatchersV3.nullValue(),
  fNumber: MatchersV3.nullValue(),
  exposureTime: MatchersV3.nullValue(),
  focalLength: MatchersV3.nullValue(),
  latitude: MatchersV3.nullValue(),
  longitude: MatchersV3.nullValue(),
  altitude: MatchersV3.nullValue(),
  fps: MatchersV3.nullValue(),
  codec: MatchersV3.nullValue(),
  hasAudio: MatchersV3.nullValue(),
  metadata: MatchersV3.nullValue(),
  metadataStatus: MatchersV3.string('failed'),
  metadataExtractedAt: MatchersV3.datetime(
    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
    '2024-01-01T00:00:00.000Z',
  ),
}

describe('Worker → media-service metadata pact', () => {
  it('PATCH /v1/assets/:id/metadata — update with all extracted fields', async () => {
    await mediaService
      .given('asset exists with id ' + ASSET_ID)
      .uponReceiving('a request to update asset metadata with all fields')
      .withRequest({
        method: 'PATCH',
        path: `/v1/assets/${ASSET_ID}/metadata`,
        headers: { 'Content-Type': 'application/json' },
        body: fullMetadataPatchBody,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: fullMetadataResponseMatcher,
      })
      .executeTest(async (mockserver) => {
        const res = await axios.patch(
          `${mockserver.url}/v1/assets/${ASSET_ID}/metadata`,
          fullMetadataPatchBody,
          { headers: { 'Content-Type': 'application/json' } },
        )
        expect(res.status).toBe(200)
        expect(res.data.mimeType).toBe('image/jpeg')
        expect(res.data.sizeBytes).toBe(5234567)
        expect(res.data.originalName).toBe('IMG_1234.HEIC')
        expect(res.data.width).toBe(4032)
        expect(res.data.height).toBe(3024)
        expect(res.data.cameraMake).toBe('Apple')
        expect(res.data.cameraModel).toBe('iPhone 15 Pro')
        expect(res.data.lensModel).toBe('iPhone 15 Pro back triple camera 6.86mm f/1.78')
        expect(res.data.orientation).toBe(1)
        expect(res.data.latitude).toBe(40.75)
        expect(res.data.longitude).toBe(-73.99)
        expect(res.data.altitude).toBe(10.5)
        expect(res.data.iso).toBe(64)
        expect(res.data.fNumber).toBe(1.78)
        expect(res.data.exposureTime).toBe(0.004)
        expect(res.data.focalLength).toBe(6.86)
        expect(res.data.metadata).toBeDefined()
        expect(res.data.metadataStatus).toBe('ready')
      })
  })

  it('PATCH /v1/assets/:id/metadata — extraction failed', async () => {
    await mediaService
      .given('asset exists with id ' + ASSET_ID)
      .uponReceiving('a request to update asset metadata as failed')
      .withRequest({
        method: 'PATCH',
        path: `/v1/assets/${ASSET_ID}/metadata`,
        headers: { 'Content-Type': 'application/json' },
        body: failedMetadataPatchBody,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: failedMetadataResponseMatcher,
      })
      .executeTest(async (mockserver) => {
        const res = await axios.patch(
          `${mockserver.url}/v1/assets/${ASSET_ID}/metadata`,
          failedMetadataPatchBody,
          { headers: { 'Content-Type': 'application/json' } },
        )
        expect(res.status).toBe(200)
        expect(res.data.metadataStatus).toBe('failed')
      })
  })

  it('PATCH /v1/assets/:id/metadata — asset not found', async () => {
    await mediaService
      .given('asset does not exist')
      .uponReceiving('a request to update metadata for missing asset')
      .withRequest({
        method: 'PATCH',
        path: `/v1/assets/${ASSET_ID}/metadata`,
        headers: { 'Content-Type': 'application/json' },
        body: { status: 'ready' },
      })
      .willRespondWith({
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: MatchersV3.like({
          message: MatchersV3.string('Asset not found'),
        }),
      })
      .executeTest(async (mockserver) => {
        try {
          await axios.patch(
            `${mockserver.url}/v1/assets/${ASSET_ID}/metadata`,
            { status: 'ready' },
            { headers: { 'Content-Type': 'application/json' } },
          )
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

  it('PATCH /v1/assets/:id/metadata — mark video as pending (deferred extraction)', async () => {
    await mediaService
      .given('asset exists with id ' + ASSET_ID)
      .uponReceiving('a request to mark video metadata as pending')
      .withRequest({
        method: 'PATCH',
        path: `/v1/assets/${ASSET_ID}/metadata`,
        headers: { 'Content-Type': 'application/json' },
        body: { status: 'pending', mimeType: 'video/mp4' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          ...failedMetadataResponseMatcher,
          metadataStatus: 'pending',
          mimeType: 'video/mp4',
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.patch(
          `${mockserver.url}/v1/assets/${ASSET_ID}/metadata`,
          { status: 'pending', mimeType: 'video/mp4' },
          { headers: { 'Content-Type': 'application/json' } },
        )
        expect(res.status).toBe(200)
        expect(res.data.metadataStatus).toBe('pending')
        expect(res.data.mimeType).toBe('video/mp4')
      })
  })

  it('PATCH /v1/assets/:id/metadata — mark thumbnail ready (worker confirms thumb generation)', async () => {
    await mediaService
      .given('asset exists with id ' + ASSET_ID)
      .uponReceiving('a request to mark thumbnail status as ready')
      .withRequest({
        method: 'PATCH',
        path: `/v1/assets/${ASSET_ID}/metadata`,
        headers: { 'Content-Type': 'application/json' },
        body: { thumbnailStatus: 'ready' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          ...failedMetadataResponseMatcher,
          metadataExtractedAt: MatchersV3.nullValue(),
          thumbnailStatus: MatchersV3.string('ready'),
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.patch(
          `${mockserver.url}/v1/assets/${ASSET_ID}/metadata`,
          { thumbnailStatus: 'ready' },
          { headers: { 'Content-Type': 'application/json' } },
        )
        expect(res.status).toBe(200)
        expect(res.data.thumbnailStatus).toBe('ready')
      })
  })

  it('PATCH /v1/assets/:id/metadata — mark transcode pending (worker starts video job)', async () => {
    await mediaService
      .given('asset exists with id ' + ASSET_ID)
      .uponReceiving('a request to mark transcode status as pending')
      .withRequest({
        method: 'PATCH',
        path: `/v1/assets/${ASSET_ID}/metadata`,
        headers: { 'Content-Type': 'application/json' },
        body: { transcodeStatus: 'pending' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          ...failedMetadataResponseMatcher,
          metadataExtractedAt: MatchersV3.nullValue(),
          transcodeStatus: MatchersV3.string('pending'),
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.patch(
          `${mockserver.url}/v1/assets/${ASSET_ID}/metadata`,
          { transcodeStatus: 'pending' },
          { headers: { 'Content-Type': 'application/json' } },
        )
        expect(res.status).toBe(200)
        expect(res.data.transcodeStatus).toBe('pending')
      })
  })

  it('PATCH /v1/assets/:id/metadata — mark transcode ready', async () => {
    await mediaService
      .given('asset exists with id ' + ASSET_ID)
      .uponReceiving('a request to mark transcode status as ready')
      .withRequest({
        method: 'PATCH',
        path: `/v1/assets/${ASSET_ID}/metadata`,
        headers: { 'Content-Type': 'application/json' },
        body: { transcodeStatus: 'ready' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          ...failedMetadataResponseMatcher,
          metadataExtractedAt: MatchersV3.nullValue(),
          transcodeStatus: MatchersV3.string('ready'),
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.patch(
          `${mockserver.url}/v1/assets/${ASSET_ID}/metadata`,
          { transcodeStatus: 'ready' },
          { headers: { 'Content-Type': 'application/json' } },
        )
        expect(res.status).toBe(200)
        expect(res.data.transcodeStatus).toBe('ready')
      })
  })
})
