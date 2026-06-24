/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { MatchersV3 } from '@pact-foundation/pact'
import axios from 'axios'
import { createPact } from '../setup'

const fileStorage = createPact('file-storage-service')

const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('Worker → file-storage-service files pact', () => {
  it('GET /v1/internal/files/:fileId/stream — stream file (happy path)', async () => {
    await fileStorage
      .given('file exists with id ' + FILE_ID)
      .uponReceiving('a request to stream a file')
      .withRequest({
        method: 'GET',
        path: `/v1/internal/files/${FILE_ID}/stream`,
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Disposition': MatchersV3.string(`attachment; filename="photo.jpg"`),
        },
        body: MatchersV3.string('fake-image-bytes'),
      })
      .executeTest(async (mockserver) => {
        const res = await axios.get(`${mockserver.url}/v1/internal/files/${FILE_ID}/stream`, {
          responseType: 'arraybuffer',
        })
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toBe('image/jpeg')
        expect(Buffer.isBuffer(res.data) || res.data).toBeTruthy()
      })
  })

  it('GET /v1/internal/files/:fileId/stream — file not found', async () => {
    await fileStorage
      .given('file does not exist')
      .uponReceiving('a request to stream a missing file')
      .withRequest({
        method: 'GET',
        path: `/v1/internal/files/${FILE_ID}/stream`,
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
          await axios.get(`${mockserver.url}/v1/internal/files/${FILE_ID}/stream`)
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
})
