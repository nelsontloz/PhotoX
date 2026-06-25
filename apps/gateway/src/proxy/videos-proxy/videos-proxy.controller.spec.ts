import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common'
import { of } from 'rxjs'
import type { Request, Response } from 'express'
import { VideosProxyController } from './videos-proxy.controller'
import { HlsProxyService } from './hls-proxy.service'
import type { Asset } from '@photox/shared-types'

interface MockHttp {
  get: ReturnType<typeof vi.fn>
}

interface MockHls {
  getMasterPlaylistText: ReturnType<typeof vi.fn>
  getHlsStream: ReturnType<typeof vi.fn>
  getOriginalFileStream: ReturnType<typeof vi.fn>
}

const OWNER_ID = 'owner-user-1'
const OTHER_USER_ID = 'other-user-2'

function createMockHttp(): MockHttp {
  return { get: vi.fn() }
}

function createMockHls(): MockHls {
  return {
    getMasterPlaylistText: vi.fn(),
    getHlsStream: vi.fn(),
    getOriginalFileStream: vi.fn(),
  }
}

function buildAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    userId: OWNER_ID,
    kind: 'video',
    fileId: 'file-abc',
    hlsMasterKey: 'uid/fid/hls/master.m3u8',
    transcodeStatus: 'ready',
    ...overrides,
  } as Asset
}

function mockReq(): Request {
  return { user: { id: OWNER_ID, email: 'owner@example.com' }, params: {} } as unknown as Request
}

function mockRes() {
  let redirected: { status: number; url: string } | undefined
  let statusCode: number | undefined
  let jsonBody: unknown
  let sentBody: unknown
  let pipedStream: unknown
  const setMock = vi.fn().mockReturnThis()
  const res = {
    redirect: vi.fn((status: number, url: string) => {
      redirected = { status, url }
    }),
    status: vi.fn(),
    json: vi.fn((body: unknown) => {
      jsonBody = body
      return res
    }),
    set: setMock,
    send: vi.fn((body: unknown) => {
      sentBody = body
      return res
    }),
    pipe: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    once: vi.fn().mockReturnThis(),
    emit: vi.fn().mockReturnThis(),
    writableEnded: false,
  }
  res.pipe.mockImplementation((stream: unknown) => {
    pipedStream = stream
    return res
  })
  res.status.mockImplementation((s: number) => {
    statusCode = s
    return res
  })
  return {
    res: res as unknown as Response,
    getRedirect: () => redirected,
    getStatus: () => statusCode,
    getJson: () => jsonBody,
    getSent: () => sentBody,
    getPipedStream: () => pipedStream,
    setMock,
  }
}

function mockStream() {
  return { pipe: vi.fn().mockReturnThis() }
}

function mockHttpGetAsset(http: MockHttp, asset: Asset | null) {
  http.get.mockImplementationOnce(() => of({ data: asset }))
}

function mockHttpGetAssetError(http: MockHttp) {
  http.get.mockImplementationOnce(() => {
    return {
      subscribe: () => {
        throw new Error('upstream down')
      },
    }
  })
}

function createController(http: MockHttp, hls: MockHls) {
  return new VideosProxyController(http as never, hls as unknown as HlsProxyService)
}

describe('VideosProxyController', () => {
  describe('GET /api/v1/videos/:assetId/stream', () => {
    it('streams the original file through the gateway when the asset belongs to the user', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      const asset = buildAsset()
      mockHttpGetAsset(http, asset)
      const upstream = mockStream()
      hls.getOriginalFileStream.mockResolvedValueOnce(upstream)

      const controller = createController(http, hls)
      const { res, getSent } = mockRes()

      await controller.streamVideo('asset-1', mockReq(), res)

      expect(http.get).toHaveBeenCalledWith(
        expect.stringContaining('/v1/assets/asset-1'),
        expect.objectContaining({ params: { userId: OWNER_ID } }),
      )
      expect(hls.getOriginalFileStream).toHaveBeenCalledWith('file-abc', OWNER_ID)
      expect(upstream.pipe).toHaveBeenCalledWith(res)
      expect(getSent()).toBeUndefined()
    })

    it('returns 403 when the asset is not accessible to the authenticated user', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAssetError(http)
      const controller = createController(http, hls)
      const { res } = mockRes()

      await expect(controller.streamVideo('missing', mockReq(), res)).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('returns 403 when the asset belongs to a different user', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset({ userId: OTHER_USER_ID }))
      const controller = createController(http, hls)
      const { res } = mockRes()

      await expect(controller.streamVideo('asset-1', mockReq(), res)).rejects.toThrow(
        ForbiddenException,
      )
    })
  })

  describe('GET /api/v1/videos/:assetId/playlist.m3u8', () => {
    it('returns the master playlist with rewritten URLs pointing back to the gateway', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      const asset = buildAsset()
      mockHttpGetAsset(http, asset)
      hls.getMasterPlaylistText.mockResolvedValueOnce(
        '#EXTM3U\n#EXT-X-VERSION:6\n0/playlist.m3u8\n1/playlist.m3u8\n',
      )
      const controller = createController(http, hls)
      const { res, getSent, getStatus } = mockRes()

      await controller.getPlaylist('asset-1', mockReq(), res)

      expect(getStatus()).toBe(200)
      const body = getSent() as string
      expect(body).toContain('/api/v1/videos/asset-1/0/playlist.m3u8')
      expect(body).toContain('/api/v1/videos/asset-1/1/playlist.m3u8')
      expect(body).not.toContain('\n0/playlist.m3u8')
    })

    it('preserves query strings when rewriting relative URLs', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset())
      hls.getMasterPlaylistText.mockResolvedValueOnce('#EXTM3U\n0/seg_001.m4s?token=abc\n')
      const controller = createController(http, hls)
      const { res, getSent } = mockRes()

      await controller.getPlaylist('asset-1', mockReq(), res)

      expect(getSent() as string).toContain('/api/v1/videos/asset-1/0/seg_001.m4s?token=abc')
    })

    it('leaves absolute URLs and #EXT-X-* lines untouched', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset())
      hls.getMasterPlaylistText.mockResolvedValueOnce(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhttps://example.com/abs.m3u8\n',
      )
      const controller = createController(http, hls)
      const { res, getSent } = mockRes()

      await controller.getPlaylist('asset-1', mockReq(), res)

      const body = getSent() as string
      expect(body).toContain('https://example.com/abs.m3u8')
      expect(body).toContain('#EXT-X-STREAM-INF:BANDWIDTH=2000000')
    })

    it('sends the upstream call with ?userId', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset())
      hls.getMasterPlaylistText.mockResolvedValueOnce('#EXTM3U\n')
      const controller = createController(http, hls)
      const { res } = mockRes()

      await controller.getPlaylist('asset-1', mockReq(), res)

      expect(http.get).toHaveBeenCalledWith(
        expect.stringContaining('/v1/assets/asset-1'),
        expect.objectContaining({ params: { userId: OWNER_ID } }),
      )
    })

    it('returns 425 when transcode is pending', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset({ transcodeStatus: 'pending' }))
      const controller = createController(http, hls)
      const { res, getStatus, getJson } = mockRes()

      await controller.getPlaylist('asset-1', mockReq(), res)

      expect(getStatus()).toBe(425)
      expect(getJson()).toEqual({ status: 'pending', message: 'Transcoding in progress' })
      expect(hls.getMasterPlaylistText).not.toHaveBeenCalled()
    })

    it('returns 409 when transcode failed', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset({ transcodeStatus: 'failed' }))
      const controller = createController(http, hls)
      const { res, getStatus, getJson } = mockRes()

      await controller.getPlaylist('asset-1', mockReq(), res)

      expect(getStatus()).toBe(409)
      expect(getJson()).toEqual({ status: 'failed', message: 'Transcoding failed' })
    })

    it('returns 500 when hlsMasterKey is missing', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset({ hlsMasterKey: null }))
      const controller = createController(http, hls)
      const { res, getStatus, getJson } = mockRes()

      await controller.getPlaylist('asset-1', mockReq(), res)

      expect(getStatus()).toBe(500)
      expect(getJson()).toEqual({ status: 'error', message: 'HLS master key missing' })
    })

    it('returns 404 when the asset is not a video', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset({ kind: 'photo' }))
      const controller = createController(http, hls)
      const { res } = mockRes()

      await expect(controller.getPlaylist('asset-1', mockReq(), res)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('returns 403 when the asset belongs to a different user', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset({ userId: OTHER_USER_ID }))
      const controller = createController(http, hls)
      const { res } = mockRes()

      await expect(controller.getPlaylist('asset-1', mockReq(), res)).rejects.toThrow(
        ForbiddenException,
      )
    })
  })

  describe('GET /api/v1/videos/:assetId/* (HLS variants and segments)', () => {
    function mockReqWithSplat(splat: string): Request {
      return {
        user: { id: OWNER_ID, email: 'owner@example.com' },
        params: { '0': splat },
      } as unknown as Request
    }

    it('streams the HLS bytes from MinIO through the gateway', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset())
      const upstream = mockStream()
      hls.getHlsStream.mockResolvedValueOnce(upstream)
      const controller = createController(http, hls)
      const { res } = mockRes()

      await controller.getHlsAsset('asset-1', mockReqWithSplat('/0/seg_000.m4s'), res)

      expect(hls.getHlsStream).toHaveBeenCalledWith('uid/fid/hls/0/seg_000.m4s')
      expect(upstream.pipe).toHaveBeenCalledWith(res)
    })

    it('sets application/vnd.apple.mpegurl for .m3u8', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset())
      hls.getHlsStream.mockResolvedValueOnce(mockStream())
      const controller = createController(http, hls)
      const { res, setMock } = mockRes()

      await controller.getHlsAsset('asset-1', mockReqWithSplat('/0/playlist.m3u8'), res)

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ 'Content-Type': 'application/vnd.apple.mpegurl' }),
      )
    })

    it('sets video/iso.segment for .m4s', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset())
      hls.getHlsStream.mockResolvedValueOnce(mockStream())
      const controller = createController(http, hls)
      const { res, setMock } = mockRes()

      await controller.getHlsAsset('asset-1', mockReqWithSplat('/0/seg_001.m4s'), res)

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ 'Content-Type': 'video/iso.segment' }),
      )
    })

    it('sets video/mp4 for init segments', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset())
      hls.getHlsStream.mockResolvedValueOnce(mockStream())
      const controller = createController(http, hls)
      const { res, setMock } = mockRes()

      await controller.getHlsAsset('asset-1', mockReqWithSplat('/0/init_0.mp4'), res)

      expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'video/mp4' }))
    })

    it('rejects path traversal with ..', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      const controller = createController(http, hls)
      const { res } = mockRes()

      await expect(
        controller.getHlsAsset('asset-1', mockReqWithSplat('/../../../etc/passwd'), res),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects paths that escape the master directory', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset({ hlsMasterKey: 'uid/fid/hls/master.m3u8' }))
      const controller = createController(http, hls)
      const { res } = mockRes()

      await expect(
        controller.getHlsAsset('asset-1', mockReqWithSplat('/../master.m3u8'), res),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects empty path', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      const controller = createController(http, hls)
      const { res } = mockRes()

      await expect(controller.getHlsAsset('asset-1', mockReqWithSplat(''), res)).rejects.toThrow(
        NotFoundException,
      )
      await expect(controller.getHlsAsset('asset-1', mockReqWithSplat('/'), res)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('returns 404 for non-video asset', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset({ kind: 'photo' }))
      const controller = createController(http, hls)
      const { res } = mockRes()

      await expect(
        controller.getHlsAsset('asset-1', mockReqWithSplat('/0/playlist.m3u8'), res),
      ).rejects.toThrow(NotFoundException)
    })

    it('returns 425 when transcode is pending', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset({ transcodeStatus: 'pending' }))
      const controller = createController(http, hls)
      const { res, getStatus, getJson } = mockRes()

      await controller.getHlsAsset('asset-1', mockReqWithSplat('/0/playlist.m3u8'), res)

      expect(getStatus()).toBe(425)
      expect(getJson()).toEqual({ status: 'pending', message: 'Transcoding in progress' })
    })

    it('returns 403 when the asset belongs to a different user', async () => {
      const http = createMockHttp()
      const hls = createMockHls()
      mockHttpGetAsset(http, buildAsset({ userId: OTHER_USER_ID }))
      const controller = createController(http, hls)
      const { res } = mockRes()

      await expect(
        controller.getHlsAsset('asset-1', mockReqWithSplat('/0/playlist.m3u8'), res),
      ).rejects.toThrow(ForbiddenException)
    })
  })
})
