/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Readable } from 'stream'
import { Controller, Get, Post, Body, Param, Res } from '@nestjs/common'
import type { Response } from 'express'

export const HLS_PLAYLIST_BODY = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n0/seg_000.m4s\n'

export const HLS_MIME_MAP: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
}

@Controller('v1/hls/files')
export class MockHlsFilesController {
  @Post('batch')
  uploadBatch(@Body('userId') _userId: string, @Body('fileId') _fileId: string) {
    return { uploaded: 1 }
  }

  @Get(':userId/:fileId/*')
  stream(
    @Param('userId') _userId: string,
    @Param('fileId') _fileId: string,
    @Param('0') relPath: string,
    @Res() res: Response,
  ) {
    const ext = relPath.slice(relPath.lastIndexOf('.'))
    const contentType = HLS_MIME_MAP[ext] ?? 'application/octet-stream'

    const body = ext === '.m3u8' ? HLS_PLAYLIST_BODY : 'fake segment bytes'

    res.set({
      'Content-Type': contentType,
      'Content-Length': String(Buffer.byteLength(body)),
    })
    res.send(body)
  }
}

export function createMockHlsMinio(overrides?: Record<string, unknown>) {
  return {
    uploadFile: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue(Readable.from(Buffer.from(HLS_PLAYLIST_BODY))),
    downloadFileRange: vi.fn().mockResolvedValue(Readable.from(Buffer.from('fake-segment-bytes'))),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    fileExists: vi.fn().mockResolvedValue(true),
    statFile: vi.fn().mockResolvedValue({
      size: 100,
      lastModified: new Date('2024-01-01T00:00:00.000Z'),
    }),
    ping: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}
