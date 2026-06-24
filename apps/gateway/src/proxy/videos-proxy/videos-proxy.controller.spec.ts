import { NotFoundException } from '@nestjs/common'
import { of } from 'rxjs'
import type { Response } from 'express'
import { VideosProxyController } from './videos-proxy.controller'

function createMockHttp(responses: { urlPattern: string; data: unknown }[]) {
  return {
    get: vi.fn().mockImplementation((url: string) => {
      const match = responses.find((r) => url.includes(r.urlPattern))
      if (match) return of({ data: match.data })
      return of({ data: null })
    }),
  }
}

function mockRes() {
  let redirectUrl: string | undefined
  let redirectStatus: number | undefined
  let jsonBody: unknown
  let jsonStatus: number | undefined
  const mock = {
    redirect: vi.fn((status: number, url: string) => {
      redirectStatus = status
      redirectUrl = url
    }),
    status: vi.fn(),
    json: vi.fn((body: unknown) => {
      jsonBody = body
    }),
  }
  mock.status.mockImplementation((s: number) => {
    jsonStatus = s
    return mock
  })
  const res = mock as unknown as Response
  return {
    res,
    getRedirect: () => ({ status: redirectStatus, url: redirectUrl }),
    getJson: () => ({ status: jsonStatus ?? redirectStatus, body: jsonBody }),
  }
}

describe('VideosProxyController', () => {
  function createController(http: { get: ReturnType<typeof vi.fn> }) {
    return new VideosProxyController(http as never)
  }

  describe('GET /api/v1/videos/:assetId/stream', () => {
    it('redirects to presigned URL when asset exists', async () => {
      const http = createMockHttp([
        { urlPattern: '/v1/assets/', data: { id: 'asset-1', fileId: 'file-abc' } },
        {
          urlPattern: '/v1/files/file-abc/url',
          data: { url: 'http://minio:9000/bucket/file-abc?signature=xxx', expiresAt: 999 },
        },
      ])
      const controller = createController(http)
      const { res, getRedirect } = mockRes()

      await controller.streamVideo('asset-1', undefined, res)

      expect(getRedirect().status).toBe(302)
      expect(getRedirect().url).toBe('http://minio:9000/bucket/file-abc?signature=xxx')

      expect(http.get).toHaveBeenCalledTimes(2)
      expect(http.get).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/v1/assets/asset-1'),
        expect.objectContaining({ timeout: 5_000 }),
      )
      expect(http.get).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/v1/files/file-abc/url'),
        expect.objectContaining({ timeout: 5_000 }),
      )
    })

    it('throws 404 when asset lookup fails', async () => {
      const http = createMockHttp([])
      http.get.mockReturnValueOnce({
        subscribe: () => {
          throw new Error('fail')
        },
      })
      const controller = createController(http)
      const { res } = mockRes()

      await expect(controller.streamVideo('missing-asset', undefined, res)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws 404 when asset data is null', async () => {
      const http = createMockHttp([{ urlPattern: '/v1/assets/', data: null }])
      const controller = createController(http)
      const { res } = mockRes()

      await expect(controller.streamVideo('asset-1', undefined, res)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('passes custom TTL to file-storage', async () => {
      const http = createMockHttp([
        { urlPattern: '/v1/assets/', data: { id: 'asset-1', fileId: 'file-abc' } },
        {
          urlPattern: '/v1/files/file-abc/url',
          data: { url: 'http://minio:9000/bucket/file-abc?sig', expiresAt: 123 },
        },
      ])
      const controller = createController(http)
      const { res } = mockRes()

      await controller.streamVideo('asset-1', '60', res)

      const calls = http.get.mock.calls as unknown[][]
      const urlConfig = calls[1]![0] as string
      expect(urlConfig).toContain('/v1/files/file-abc/url?ttl=60')
    })

    it('omits TTL query param when not specified', async () => {
      const http = createMockHttp([
        { urlPattern: '/v1/assets/', data: { id: 'asset-1', fileId: 'file-abc' } },
        {
          urlPattern: '/v1/files/file-abc/url',
          data: { url: 'http://minio:9000/bucket/file-abc?sig', expiresAt: 123 },
        },
      ])
      const controller = createController(http)
      const { res } = mockRes()

      await controller.streamVideo('asset-1', undefined, res)

      const calls = http.get.mock.calls as unknown[][]
      const urlConfig = calls[1]![0] as string
      expect(urlConfig).toContain('/v1/files/file-abc/url')
      expect(urlConfig).not.toContain('ttl')
    })
  })

  describe('GET /api/v1/videos/:assetId/playlist.m3u8', () => {
    it('redirects to public HLS URL when transcode is ready', async () => {
      const http = createMockHttp([
        {
          urlPattern: '/v1/assets/',
          data: {
            id: 'asset-1',
            kind: 'video',
            transcodeStatus: 'ready',
            hlsMasterKey: 'user-abc/file-xyz/hls/master.m3u8',
          },
        },
      ])
      const controller = createController(http)
      const { res, getRedirect } = mockRes()

      await controller.getPlaylist('asset-1', res)

      expect(getRedirect().status).toBe(302)
      expect(getRedirect().url).toBe(
        'http://localhost:9000/photox-files/user-abc/file-xyz/hls/master.m3u8',
      )
    })

    it('returns 425 when transcode is pending', async () => {
      const http = createMockHttp([
        {
          urlPattern: '/v1/assets/',
          data: { id: 'asset-1', kind: 'video', transcodeStatus: 'pending' },
        },
      ])
      const controller = createController(http)
      const { res, getJson } = mockRes()

      await controller.getPlaylist('asset-1', res)

      const json = getJson()
      expect(json.body).toEqual({ status: 'pending', message: 'Transcoding in progress' })
    })

    it('returns 409 when transcode failed', async () => {
      const http = createMockHttp([
        {
          urlPattern: '/v1/assets/',
          data: { id: 'asset-1', kind: 'video', transcodeStatus: 'failed' },
        },
      ])
      const controller = createController(http)
      const { res, getJson } = mockRes()

      await controller.getPlaylist('asset-1', res)

      const json = getJson()
      expect(json.body).toEqual({ status: 'failed', message: 'Transcoding failed' })
    })

    it('throws 404 when asset not found', async () => {
      const http = createMockHttp([])
      http.get.mockReturnValueOnce({
        subscribe: () => {
          throw new Error('fail')
        },
      })
      const controller = createController(http)
      const { res } = mockRes()

      await expect(controller.getPlaylist('missing', res)).rejects.toThrow(NotFoundException)
    })

    it('throws 404 when asset is not a video', async () => {
      const http = createMockHttp([
        {
          urlPattern: '/v1/assets/',
          data: { id: 'asset-1', kind: 'photo', transcodeStatus: 'ready' },
        },
      ])
      const controller = createController(http)
      const { res } = mockRes()

      await expect(controller.getPlaylist('asset-1', res)).rejects.toThrow(NotFoundException)
    })

    it('returns 500 when transcode is ready but hlsMasterKey is missing', async () => {
      const http = createMockHttp([
        {
          urlPattern: '/v1/assets/',
          data: { id: 'asset-1', kind: 'video', transcodeStatus: 'ready', hlsMasterKey: null },
        },
      ])
      const controller = createController(http)
      const { res, getJson } = mockRes()

      await controller.getPlaylist('asset-1', res)

      const json = getJson()
      expect(json.body).toEqual({ status: 'error', message: 'HLS master key missing' })
    })

    it('builds public URL from env vars correctly', async () => {
      const http = createMockHttp([
        {
          urlPattern: '/v1/assets/',
          data: {
            id: 'asset-1',
            kind: 'video',
            transcodeStatus: 'ready',
            hlsMasterKey: 'uid/fid/hls/master.m3u8',
          },
        },
      ])
      const controller = createController(http)
      const { res, getRedirect } = mockRes()

      await controller.getPlaylist('asset-1', res)

      expect(getRedirect().url).toContain('/photox-files/')
      expect(getRedirect().url).toContain('uid/fid/hls/master.m3u8')
      expect(getRedirect().url).toMatch(/^http:\/\/localhost:\d+/)
    })
  })
})
