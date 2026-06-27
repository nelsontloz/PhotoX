/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Readable } from 'node:stream'
import { SERVICE_URLS } from '@photox/shared-config'
import { HttpModule } from '@nestjs/axios'
import { Test } from '@nestjs/testing'
import { HlsProxyService } from '../../../../src/proxy/videos-proxy/hls-proxy.service'
import { createPact } from '../setup'

const fileStorage = createPact('file-storage-service')

const HLS_MASTER_KEY = 'user-1/file-1/hls/master.m3u8'
const HLS_SEGMENT_KEY = 'user-1/file-1/hls/0/seg_000.m4s'

describe('Gateway → file-storage-service HLS pact', () => {
  let hlsService: HlsProxyService
  let originalUrl: string

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [HlsProxyService],
    }).compile()
    hlsService = module.get(HlsProxyService)
  })

  beforeEach(() => {
    originalUrl = (SERVICE_URLS as Record<string, string>)['file-storage-service']!
  })

  afterEach(() => {
    ;(SERVICE_URLS as Record<string, string>)['file-storage-service'] = originalUrl
  })

  it('GET /v1/hls/files/:userId/:fileId/master.m3u8 — fetch HLS master playlist', async () => {
    await fileStorage
      .given('HLS master playlist exists')
      .uponReceiving('a request to fetch the HLS master playlist')
      .withRequest({
        method: 'GET',
        path: '/v1/hls/files/user-1/file-1/master.m3u8',
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
        },
        body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n0/seg_000.m4s\n',
      })
      .executeTest(async (mockserver) => {
        ;(SERVICE_URLS as Record<string, string>)['file-storage-service'] = mockserver.url!
        const text = await hlsService.fetchHls(HLS_MASTER_KEY, 'text')
        expect(text).toContain('#EXTM3U')
      })
  })

  it('GET /v1/hls/files/:userId/:fileId/0/seg_000.m4s — fetch HLS segment', async () => {
    await fileStorage
      .given('HLS segment exists')
      .uponReceiving('a request to fetch an HLS segment')
      .withRequest({
        method: 'GET',
        path: '/v1/hls/files/user-1/file-1/0/seg_000.m4s',
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'video/iso.segment',
        },
      })
      .executeTest(async (mockserver) => {
        ;(SERVICE_URLS as Record<string, string>)['file-storage-service'] = mockserver.url!
        const stream = await hlsService.fetchHls(HLS_SEGMENT_KEY, 'stream')
        expect(stream).toBeInstanceOf(Readable)
        const chunks: Buffer[] = []
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk))
        }
        expect(chunks.length).toBeGreaterThanOrEqual(0)
      })
  })
})
