/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { MatchersV3 } from '@pact-foundation/pact'
import axios from 'axios'
import { createPact } from '../setup'

const mediaService = createPact('media-service', 'thumbnails')

const ASSET_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'
const SIZE = 'sm'

const thumbnailResponseMatcher = {
  size: MatchersV3.string(SIZE),
  fileId: MatchersV3.uuid(FILE_ID),
  width: MatchersV3.integer(150),
  height: MatchersV3.integer(150),
  bytes: MatchersV3.integer(12345),
  createdAt: MatchersV3.datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2024-01-01T00:00:00.000Z'),
}

describe('Worker → media-service thumbnails pact', () => {
  it('POST /v1/assets/:id/thumbnails — register thumbnail (happy path)', async () => {
    await mediaService
      .given('asset exists with id ' + ASSET_ID)
      .uponReceiving('a request to register a thumbnail')
      .withRequest({
        method: 'POST',
        path: `/v1/assets/${ASSET_ID}/thumbnails`,
        headers: { 'Content-Type': 'application/json' },
        body: {
          size: SIZE,
          fileId: FILE_ID,
          width: 150,
          height: 150,
          bytes: 12345,
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: thumbnailResponseMatcher,
      })
      .executeTest(async (mockserver) => {
        const res = await axios.post(
          `${mockserver.url}/v1/assets/${ASSET_ID}/thumbnails`,
          {
            size: SIZE,
            fileId: FILE_ID,
            width: 150,
            height: 150,
            bytes: 12345,
          },
          { headers: { 'Content-Type': 'application/json' } },
        )
        expect(res.status).toBe(201)
        expect(res.data.size).toBe(SIZE)
        expect(res.data.fileId).toBe(FILE_ID)
        expect(res.data.width).toBe(150)
        expect(res.data.height).toBe(150)
        expect(res.data.bytes).toBe(12345)
      })
  })

  it('POST /v1/assets/:id/thumbnails — asset not found', async () => {
    await mediaService
      .given('asset does not exist')
      .uponReceiving('a request to register a thumbnail for missing asset')
      .withRequest({
        method: 'POST',
        path: `/v1/assets/${ASSET_ID}/thumbnails`,
        headers: { 'Content-Type': 'application/json' },
        body: {
          size: SIZE,
          fileId: FILE_ID,
          width: 150,
          height: 150,
          bytes: 12345,
        },
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
          await axios.post(
            `${mockserver.url}/v1/assets/${ASSET_ID}/thumbnails`,
            {
              size: SIZE,
              fileId: FILE_ID,
              width: 150,
              height: 150,
              bytes: 12345,
            },
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
})
