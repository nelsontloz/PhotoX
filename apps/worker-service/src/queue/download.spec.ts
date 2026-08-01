import { describe, it, expect, vi } from 'vitest'
import { of } from 'rxjs'
import { Readable } from 'stream'
import { readFile, readdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'node:crypto'
import { HttpService } from '@nestjs/axios'
import { downloadToTemp } from './download'

function mockHttp(data: Readable, headers: Record<string, string>): HttpService {
  return {
    get: vi.fn().mockReturnValue(of({ data, headers, status: 200 } as never)),
  } as unknown as HttpService
}

function tempDir(): string {
  return join(tmpdir(), `photox-dl-test-${randomUUID()}`)
}

describe('downloadToTemp', () => {
  it('writes concatenated stream content to a temp file', async () => {
    const destDir = tempDir()
    try {
      const result = await downloadToTemp(
        mockHttp(Readable.from(['chunk1', 'chunk2']), { 'content-type': 'video/mp4' }),
        'http://127.0.0.1:1/file.mp4',
        destDir,
      )
      expect(result.ext).toBe('mp4')
      expect(await readFile(result.path, 'utf8')).toBe('chunk1chunk2')
    } finally {
      await rm(destDir, { recursive: true, force: true })
    }
  })

  it('derives the extension from the content-type', async () => {
    const destDir = tempDir()
    try {
      const webm = await downloadToTemp(
        mockHttp(Readable.from(['a']), { 'content-type': 'video/webm' }),
        'u',
        destDir,
      )
      expect(webm.ext).toBe('webm')

      const mov = await downloadToTemp(
        mockHttp(Readable.from(['a']), { 'content-type': 'video/quicktime' }),
        'u',
        destDir,
      )
      expect(mov.ext).toBe('mov')

      const jpeg = await downloadToTemp(
        mockHttp(Readable.from(['a']), { 'content-type': 'image/jpeg' }),
        'u',
        destDir,
      )
      expect(jpeg.ext).toBe('mp4')
    } finally {
      await rm(destDir, { recursive: true, force: true })
    }
  })

  it('removes the temp file when the stream errors mid-pipe', async () => {
    const failing = new Readable({
      read() {
        this.push('partial')
        this.destroy(new Error('pipe boom'))
      },
    })
    const destDir = tempDir()
    await expect(
      downloadToTemp(mockHttp(failing, { 'content-type': 'video/mp4' }), 'u', destDir),
    ).rejects.toThrow('pipe boom')
    expect(await readdir(destDir)).toHaveLength(0)
    await rm(destDir, { recursive: true, force: true })
  })
})
