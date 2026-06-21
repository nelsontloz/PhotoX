import { MatchersV3 } from '@pact-foundation/pact'
import axios from 'axios'
import { createPact } from './setup'

const provider = createPact('file-storage-service')
const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

describe('Gateway → file-storage-service files pact', () => {
  it('GET /v1/files — list happy path', async () => {
    await provider
      .given('user 1 has files')
      .uponReceiving('a list files request')
      .withRequest({
        method: 'GET',
        path: '/v1/files',
        headers: { 'x-user-id': USER_ID },
        query: { limit: '20', offset: '0' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          items: MatchersV3.atLeastOneLike({
            id: MatchersV3.uuid('f47ac10b-58cc-4372-a567-0e02b2c3d479'),
            userId: USER_ID,
            originalName: 'photo.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: MatchersV3.integer(1024000),
            createdAt: MatchersV3.datetime(
              "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
              '2024-01-01T00:00:00.000Z',
            ),
          }),
          total: MatchersV3.integer(1),
          limit: 20,
          offset: 0,
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.get(`${mockserver.url}/v1/files`, {
          params: { limit: '20', offset: '0' },
          headers: { 'x-user-id': USER_ID },
        })
        const data = res.data as { items: unknown[] }
        expect(res.status).toBe(200)
        expect(data.items).toHaveLength(1)
      })
  })

  it('GET /v1/files/:fileId — get one happy path', async () => {
    await provider
      .given('file f47ac10b-58cc-4372-a567-0e02b2c3d479 exists for user 1')
      .uponReceiving('a get file request')
      .withRequest({
        method: 'GET',
        path: '/v1/files/f47ac10b-58cc-4372-a567-0e02b2c3d479',
        headers: { 'x-user-id': USER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          userId: USER_ID,
          storageKey:
            'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/f47ac10b-58cc-4372-a567-0e02b2c3d479.jpg',
          originalName: 'photo.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: MatchersV3.integer(1024000),
          checksumSha256: MatchersV3.string(
            'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          ),
          createdAt: MatchersV3.datetime(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            '2024-01-01T00:00:00.000Z',
          ),
        },
      })
      .executeTest(async (mockserver) => {
        const res = await axios.get(
          `${mockserver.url}/v1/files/f47ac10b-58cc-4372-a567-0e02b2c3d479`,
          {
            headers: { 'x-user-id': USER_ID },
          },
        )
        const data = res.data as { id: string }
        expect(res.status).toBe(200)
        expect(data.id).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479')
      })
  })

  it('DELETE /v1/files/:fileId — happy path', async () => {
    await provider
      .given('file f47ac10b-58cc-4372-a567-0e02b2c3d479 exists for user 1')
      .uponReceiving('a delete file request')
      .withRequest({
        method: 'DELETE',
        path: '/v1/files/f47ac10b-58cc-4372-a567-0e02b2c3d479',
        headers: { 'x-user-id': USER_ID },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockserver) => {
        const res = await axios.delete(
          `${mockserver.url}/v1/files/f47ac10b-58cc-4372-a567-0e02b2c3d479`,
          {
            headers: { 'x-user-id': USER_ID },
            validateStatus: () => true,
          },
        )
        expect(res.status).toBe(204)
      })
  })
})
