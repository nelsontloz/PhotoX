import { of, throwError } from 'rxjs'
import type { HttpService } from '@nestjs/axios'
import { HlsHttpClient } from './hls-http.client'

interface MockHttp {
  post: ReturnType<typeof vi.fn>
}

function createMockHttp(): MockHttp {
  return { post: vi.fn() }
}

describe('HlsHttpClient', () => {
  describe('uploadBatch', () => {
    it('posts to the file-storage batch endpoint with a FormData body and no explicit Content-Type', async () => {
      const http = createMockHttp()
      http.post.mockReturnValueOnce(of({ data: { uploaded: 2 }, status: 201 }))
      const client = new HlsHttpClient(http as unknown as HttpService)

      await client.uploadBatch('user-1', 'file-1', [
        {
          key: 'user-1/file-1/hls/master.m3u8',
          body: Buffer.from('#EXTM3U\n'),
          contentType: 'application/vnd.apple.mpegurl',
        },
        {
          key: 'user-1/file-1/hls/0/seg_000.m4s',
          body: Buffer.from([0, 1, 2, 3]),
          contentType: 'video/iso.segment',
        },
      ])

      expect(http.post).toHaveBeenCalledTimes(1)
      const call = http.post.mock.calls[0] as [string, FormData, Record<string, unknown>]
      const [url, body, options] = call
      expect(url).toMatch(/\/v1\/hls\/files\/batch$/)
      expect(body).toBeInstanceOf(FormData)
      expect(options.headers).toBeUndefined()
      expect(options.timeout).toBeGreaterThan(0)
      expect(options.maxBodyLength).toBe(Infinity)
      expect(options.maxContentLength).toBe(Infinity)
    })

    it('sends the relative paths as a JSON-encoded "paths" form field (multer strips the directory from multipart filenames)', async () => {
      const http = createMockHttp()
      http.post.mockReturnValueOnce(of({ data: { uploaded: 3 }, status: 201 }))
      const client = new HlsHttpClient(http as unknown as HttpService)

      await client.uploadBatch('user-1', 'file-1', [
        {
          key: 'user-1/file-1/hls/master.m3u8',
          body: Buffer.from('#EXTM3U\n'),
          contentType: 'application/vnd.apple.mpegurl',
        },
        {
          key: 'user-1/file-1/hls/0/playlist.m3u8',
          body: Buffer.from('0/playlist'),
          contentType: 'application/vnd.apple.mpegurl',
        },
        {
          key: 'user-1/file-1/hls/0/seg_000.m4s',
          body: Buffer.from('0/segment'),
          contentType: 'video/iso.segment',
        },
      ])

      const body = http.post.mock.calls[0]?.[1] as FormData
      const pathsJson = body.get('paths')
      expect(pathsJson).not.toBeNull()
      const parsed = JSON.parse(pathsJson as string) as string[]
      expect(parsed).toEqual(['master.m3u8', '0/playlist.m3u8', '0/seg_000.m4s'])
    })

    it('pairs files with paths by index in the order they were appended', async () => {
      const http = createMockHttp()
      http.post.mockReturnValueOnce(of({ data: { uploaded: 2 }, status: 201 }))
      const client = new HlsHttpClient(http as unknown as HttpService)

      await client.uploadBatch('user-1', 'file-1', [
        {
          key: 'user-1/file-1/hls/0/seg_000.m4s',
          body: Buffer.from([1]),
          contentType: 'video/iso.segment',
        },
        {
          key: 'user-1/file-1/hls/1/seg_001.m4s',
          body: Buffer.from([2]),
          contentType: 'video/iso.segment',
        },
      ])

      const body = http.post.mock.calls[0]?.[1] as FormData
      const paths = JSON.parse(body.get('paths') as string) as string[]
      const files = body.getAll('files') as File[]
      expect(paths).toEqual(['0/seg_000.m4s', '1/seg_001.m4s'])
      expect(files).toHaveLength(2)
    })

    it('includes userId and fileId as form fields', () => {
      const http = createMockHttp()
      http.post.mockReturnValueOnce(of({ data: { uploaded: 1 }, status: 201 }))
      const client = new HlsHttpClient(http as unknown as HttpService)

      void client.uploadBatch('user-1', 'file-1', [
        {
          key: 'user-1/file-1/hls/master.m3u8',
          body: Buffer.from('#EXTM3U\n'),
          contentType: 'application/vnd.apple.mpegurl',
        },
      ])

      const body = http.post.mock.calls[0]?.[1] as FormData
      expect(body.get('userId')).toBe('user-1')
      expect(body.get('fileId')).toBe('file-1')
    })

    it('returns immediately when the batch is empty', async () => {
      const http = createMockHttp()
      const client = new HlsHttpClient(http as unknown as HttpService)

      await client.uploadBatch('user-1', 'file-1', [])

      expect(http.post).not.toHaveBeenCalled()
    })

    it('propagates HTTP errors from file-storage', async () => {
      const http = createMockHttp()
      http.post.mockReturnValueOnce(throwError(() => new Error('upstream 5xx')))
      const client = new HlsHttpClient(http as unknown as HttpService)

      await expect(
        client.uploadBatch('user-1', 'file-1', [
          {
            key: 'user-1/file-1/hls/master.m3u8',
            body: Buffer.from('#EXTM3U\n'),
            contentType: 'application/vnd.apple.mpegurl',
          },
        ]),
      ).rejects.toThrow('upstream 5xx')
    })
  })
})
