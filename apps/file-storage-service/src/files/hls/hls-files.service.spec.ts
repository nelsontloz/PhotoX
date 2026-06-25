import { Readable } from 'stream'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { HlsFilesService } from './hls-files.service'

function createMockMinio() {
  return {
    uploadFile: vi.fn(),
    downloadFile: vi.fn(),
    downloadFileRange: vi.fn(),
    statFile: vi.fn(),
  }
}

describe('HlsFilesService', () => {
  let service: HlsFilesService
  let minio: ReturnType<typeof createMockMinio>

  beforeEach(() => {
    minio = createMockMinio()
    service = new HlsFilesService(minio as never)
  })

  describe('uploadBatch', () => {
    it('uses the path from the paths array, not file.originalname, to build the storage key', async () => {
      const files = [
        {
          originalname: 'wrong.m4s',
          buffer: Buffer.from('a'),
          mimetype: 'video/iso.segment',
          size: 1,
        },
      ]
      const paths = ['0/seg_000.m4s']
      minio.uploadFile.mockResolvedValue(undefined)

      await service.uploadBatch('user-1', 'file-1', paths, files)

      expect(minio.uploadFile).toHaveBeenCalledWith(
        'user-1/file-1/hls/0/seg_000.m4s',
        expect.any(Readable),
        1,
        'video/iso.segment',
      )
    })

    it('handles paths with subdirectories (HLS variant directories)', async () => {
      const playlist = Buffer.from('#EXTM3U')
      const init = Buffer.from('init')
      const seg = Buffer.from('seg')
      const files = [
        {
          originalname: 'p.m3u8',
          buffer: playlist,
          mimetype: 'application/vnd.apple.mpegurl',
          size: playlist.length,
        },
        { originalname: 'i.mp4', buffer: init, mimetype: 'video/mp4', size: init.length },
        { originalname: 's.m4s', buffer: seg, mimetype: 'video/iso.segment', size: seg.length },
      ]
      const paths = ['0/playlist.m3u8', '0/init_0.mp4', '0/seg_000.m4s']
      minio.uploadFile.mockResolvedValue(undefined)

      await service.uploadBatch('user-1', 'file-1', paths, files)

      expect(minio.uploadFile).toHaveBeenCalledTimes(3)
      expect(minio.uploadFile).toHaveBeenCalledWith(
        'user-1/file-1/hls/0/playlist.m3u8',
        expect.any(Readable),
        playlist.length,
        'application/vnd.apple.mpegurl',
      )
      expect(minio.uploadFile).toHaveBeenCalledWith(
        'user-1/file-1/hls/0/init_0.mp4',
        expect.any(Readable),
        init.length,
        'video/mp4',
      )
      expect(minio.uploadFile).toHaveBeenCalledWith(
        'user-1/file-1/hls/0/seg_000.m4s',
        expect.any(Readable),
        seg.length,
        'video/iso.segment',
      )
    })

    it('throws BadRequestException if files is empty', async () => {
      await expect(service.uploadBatch('user-1', 'file-1', [], [])).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException if files.length > 100', async () => {
      const files = Array.from({ length: 101 }, () => ({
        originalname: 'x',
        buffer: Buffer.from('x'),
        mimetype: 'application/octet-stream',
        size: 1,
      }))
      const paths = Array.from({ length: 101 }, (_, i) => `${i}.m4s`)
      await expect(service.uploadBatch('user-1', 'file-1', paths, files)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException if paths and files have different lengths', async () => {
      const files = [
        { originalname: 'a.m4s', buffer: Buffer.from('a'), mimetype: 'video/iso.segment', size: 1 },
        { originalname: 'b.m4s', buffer: Buffer.from('b'), mimetype: 'video/iso.segment', size: 1 },
      ]
      const paths = ['0/seg_000.m4s']
      await expect(service.uploadBatch('user-1', 'file-1', paths, files)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException if a path contains ".."', async () => {
      const files = [
        { originalname: 'a.m4s', buffer: Buffer.from('a'), mimetype: 'video/iso.segment', size: 1 },
      ]
      const paths = ['../escape.m4s']
      await expect(service.uploadBatch('user-1', 'file-1', paths, files)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException if a path starts with "/"', async () => {
      const files = [
        { originalname: 'a.m4s', buffer: Buffer.from('a'), mimetype: 'video/iso.segment', size: 1 },
      ]
      const paths = ['/abs.m4s']
      await expect(service.uploadBatch('user-1', 'file-1', paths, files)).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('stream', () => {
    it('calls downloadFile with no range header and returns the stream', async () => {
      const fakeStream = new Readable()
      minio.statFile.mockResolvedValue({ size: 1000, lastModified: new Date() })
      minio.downloadFile.mockResolvedValue(fakeStream)

      const result = await service.stream('user-1', 'file-1', 'segment.m4s', undefined)

      expect(result.stream).toBe(fakeStream)
      expect(result.totalSize).toBe(1000)
      expect(result.range).toBeUndefined()
      expect(minio.downloadFile).toHaveBeenCalledWith('user-1/file-1/hls/segment.m4s')
      expect(minio.downloadFileRange).not.toHaveBeenCalled()
    })

    it('calls downloadFileRange with correct start/length for a valid range header', async () => {
      const fakeStream = new Readable()
      minio.statFile.mockResolvedValue({ size: 1000, lastModified: new Date() })
      minio.downloadFileRange.mockResolvedValue(fakeStream)

      const result = await service.stream('user-1', 'file-1', 'segment.m4s', 'bytes=100-499')

      expect(result.stream).toBe(fakeStream)
      expect(result.totalSize).toBe(1000)
      expect(result.range).toEqual({ start: 100, end: 499 })
      expect(minio.downloadFileRange).toHaveBeenCalledWith(
        'user-1/file-1/hls/segment.m4s',
        100,
        400,
      )
      expect(minio.downloadFile).not.toHaveBeenCalled()
    })

    it('throws BadRequestException for a malformed range header', async () => {
      minio.statFile.mockResolvedValue({ size: 1000, lastModified: new Date() })

      await expect(
        service.stream('user-1', 'file-1', 'segment.m4s', 'bytes=abc-def'),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws NotFoundException when statFile rejects', async () => {
      minio.statFile.mockRejectedValue(new Error('NoSuchKey'))

      await expect(service.stream('user-1', 'file-1', 'missing.m4s', undefined)).rejects.toThrow(
        NotFoundException,
      )
    })
  })
})
