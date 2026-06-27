/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { MatchersV3 } from '@pact-foundation/pact'
import axios from 'axios'
import FormData from 'form-data'
import { createPact } from '../setup'

const fileStorage = createPact('file-storage-service')

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const FILE_ID = '550e8400-e29b-41d4-a716-446655440000'

const M3U8_DATA = Buffer.from('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n0/seg_000.m4s\n')

describe('Worker → file-storage-service HLS pact', () => {
  it('POST /v1/hls/files/batch — upload HLS segments (happy path)', async () => {
    await fileStorage
      .given('user can upload HLS files')
      .uponReceiving('a request to upload a batch of HLS segment files')
      .withRequest({
        method: 'POST',
        path: '/v1/hls/files/batch',
        headers: {
          'Content-Type': MatchersV3.regex(
            'multipart/form-data; boundary=.+',
            'multipart/form-data; boundary=test',
          ),
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: { uploaded: 1 },
      })
      .executeTest(async (mockserver) => {
        const form = new FormData()
        form.append('userId', USER_ID)
        form.append('fileId', FILE_ID)
        form.append('files', M3U8_DATA, {
          filename: 'master.m3u8',
          contentType: 'application/vnd.apple.mpegurl',
        })

        const res = await axios.post(`${mockserver.url}/v1/hls/files/batch`, form, {
          headers: form.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        })
        expect(res.status).toBe(201)
        expect(res.data.uploaded).toBe(1)
      })
  })
})
