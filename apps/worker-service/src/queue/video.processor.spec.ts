import { describe, it, expect, vi } from 'vitest'
import { of } from 'rxjs'
import { Readable } from 'stream'
import { rm, stat } from 'fs/promises'
import { join, sep } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'node:crypto'
import { HttpService } from '@nestjs/axios'
import { VideoProcessor } from './video.processor'
import { BullMqService } from './bullmq.service'

describe('VideoProcessor.downloadSource', () => {
  it('streams the source to a temp file in the destination directory', async () => {
    const fileId = randomUUID()
    const userId = randomUUID()
    const destDir = join(tmpdir(), `photox-vp-test-${fileId}`)
    const fileBytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])
    const presignedUrl = 'http://127.0.0.1:1/never-fetched.mp4'

    const http = {
      get: vi
        .fn()
        .mockReturnValueOnce(of({ data: { url: presignedUrl }, headers: {}, status: 200 } as never))
        .mockReturnValueOnce(
          of({
            data: Readable.from([fileBytes]),
            headers: { 'content-type': 'video/mp4' },
            status: 200,
          } as never),
        ),
    } as unknown as HttpService

    const processor = new VideoProcessor({} as BullMqService, http)

    const downloadSource = (
      processor as unknown as {
        downloadSource: (id: string, uid: string, dir: string) => Promise<string>
      }
    ).downloadSource.bind(processor)

    const result = await downloadSource(fileId, userId, destDir)

    expect(result.startsWith(destDir + sep)).toBe(true)
    expect(result.endsWith('.mp4')).toBe(true)
    const fileStat = await stat(result)
    expect(fileStat.isFile()).toBe(true)
    expect(fileStat.size).toBe(fileBytes.length)

    const expectedUrl = `http://localhost:3003/v1/files/${fileId}/url?userId=${userId}&ttl=600`
    type MockFn = ReturnType<typeof vi.fn>
    const getMock = (http as unknown as { get: MockFn }).get
    expect(getMock).toHaveBeenCalledWith(expectedUrl, expect.objectContaining({ timeout: 5_000 }))
    expect(getMock).toHaveBeenCalledWith(
      presignedUrl,
      expect.objectContaining({ responseType: 'stream', timeout: 300_000 }),
    )

    await rm(destDir, { recursive: true, force: true })
  })
})
