import { MatchersV3 } from '@pact-foundation/pact'
import axios from 'axios'
import { createPact } from './setup'

const provider = createPact('media-service')
const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

describe('Gateway → media-service assets pact', () => {
  it('POST /v1/assets — create happy path', async () => {
    await provider
      .given('user 1 can create assets')
      .uponReceiving('a create asset request')
      .withRequest({
        method: 'POST',
        path: '/v1/assets',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': USER_ID,
        },
        body: { fileId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', kind: 'photo' },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: {
          id: MatchersV3.uuid('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'),
          userId: USER_ID,
          kind: 'photo',
          fileId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          uploadedAt: MatchersV3.datetime(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            '2024-01-01T00:00:00.000Z',
          ),
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
      })
      .executeTest(async (mockserver) => {
        const res = await axios.post(
          `${mockserver.url}/v1/assets`,
          { fileId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', kind: 'photo' },
          { headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID } },
        )
        const data = res.data as { id: string; kind: string }
        expect(res.status).toBe(201)
        expect(data.id).toBeTruthy()
        expect(data.kind).toBe('photo')
      })
  })

  it('GET /v1/assets — list happy path', async () => {
    await provider
      .given('user 1 has assets')
      .uponReceiving('a list assets request')
      .withRequest({
        method: 'GET',
        path: '/v1/assets',
        headers: { 'x-user-id': USER_ID },
        query: { limit: '20', offset: '0', isTrashed: 'false' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          items: MatchersV3.atLeastOneLike({
            id: MatchersV3.uuid('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'),
            userId: USER_ID,
            kind: 'photo',
            fileId: MatchersV3.uuid('f47ac10b-58cc-4372-a567-0e02b2c3d479'),
            uploadedAt: MatchersV3.datetime(
              "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
              '2024-01-01T00:00:00.000Z',
            ),
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
          }),
          total: MatchersV3.integer(1),
          limit: 20,
          offset: 0,
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.get(`${mockserver.url}/v1/assets`, {
          params: { limit: '20', offset: '0', isTrashed: 'false' },
          headers: { 'x-user-id': USER_ID },
        })
        const data = res.data as { items: unknown[]; total: number }
        expect(res.status).toBe(200)
        expect(data.items).toHaveLength(1)
        expect(data.total).toBe(1)
      })
  })

  it('GET /v1/assets/:id — get one happy path', async () => {
    await provider
      .given('asset a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22 exists for user 1')
      .uponReceiving('a get asset request')
      .withRequest({
        method: 'GET',
        path: '/v1/assets/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        headers: { 'x-user-id': USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
          userId: USER_ID,
          kind: 'photo',
          fileId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          uploadedAt: MatchersV3.datetime(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            '2024-01-01T00:00:00.000Z',
          ),
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
      })
      .executeTest(async (mockserver) => {
        const res = await axios.get(
          `${mockserver.url}/v1/assets/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22`,
          {
            headers: { 'x-user-id': USER_ID },
          },
        )
        const data = res.data as { id: string }
        expect(res.status).toBe(200)
        expect(data.id).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22')
      })
  })

  it('PATCH /v1/assets/:id — update happy path', async () => {
    await provider
      .given('asset a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22 exists for user 1')
      .uponReceiving('an update asset request')
      .withRequest({
        method: 'PATCH',
        path: '/v1/assets/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': USER_ID,
        },
        body: { title: 'Updated Title', favorite: true },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
          userId: USER_ID,
          kind: 'photo',
          fileId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          uploadedAt: MatchersV3.datetime(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            '2024-01-01T00:00:00.000Z',
          ),
          isTrashed: false,
          trashedAt: null,
          title: 'Updated Title',
          description: null,
          takenAt: null,
          favorite: true,
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
      })
      .executeTest(async (mockserver) => {
        const res = await axios.patch(
          `${mockserver.url}/v1/assets/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22`,
          { title: 'Updated Title', favorite: true },
          { headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID } },
        )
        const data = res.data as { title: string; favorite: boolean }
        expect(res.status).toBe(200)
        expect(data.title).toBe('Updated Title')
        expect(data.favorite).toBe(true)
      })
  })

  it('POST /v1/assets/:id/trash — happy path', async () => {
    await provider
      .given('asset a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22 exists for user 1')
      .uponReceiving('a trash asset request')
      .withRequest({
        method: 'POST',
        path: '/v1/assets/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22/trash',
        headers: { 'x-user-id': USER_ID },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        const res = await axios.post(
          `${mockserver.url}/v1/assets/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22/trash`,
          undefined,
          { headers: { 'x-user-id': USER_ID }, validateStatus: () => true },
        )
        expect(res.status).toBe(204)
      })
  })

  it('POST /v1/assets/:id/restore — happy path', async () => {
    await provider
      .given('asset a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22 is trashed for user 1')
      .uponReceiving('a restore asset request')
      .withRequest({
        method: 'POST',
        path: '/v1/assets/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22/restore',
        headers: { 'x-user-id': USER_ID },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        const res = await axios.post(
          `${mockserver.url}/v1/assets/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22/restore`,
          undefined,
          { headers: { 'x-user-id': USER_ID }, validateStatus: () => true },
        )
        expect(res.status).toBe(204)
      })
  })
})
