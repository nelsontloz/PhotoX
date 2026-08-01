import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { randomUUID } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { pipeline } from 'stream/promises'

export interface DownloadResult {
  path: string
  ext: string
  contentType: string
  contentDisposition: string
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name]
  return typeof value === 'string' ? value : Array.isArray(value) ? (value[0] ?? '') : ''
}

export async function downloadToTemp(
  http: HttpService,
  url: string,
  destDir: string,
): Promise<DownloadResult> {
  const res = await firstValueFrom(http.get(url, { responseType: 'stream', timeout: 300_000 }))
  const headers = res.headers as Record<string, string | string[] | undefined>
  const contentType = header(headers, 'content-type')
  const ext = contentType.includes('webm')
    ? 'webm'
    : contentType.includes('quicktime')
      ? 'mov'
      : 'mp4'
  const destPath = join(destDir, `${randomUUID()}.${ext}`)
  await mkdir(destDir, { recursive: true })
  try {
    await pipeline(res.data as NodeJS.ReadableStream, createWriteStream(destPath))
  } catch (err) {
    await rm(destPath, { force: true }).catch(() => undefined)
    throw err
  }
  return {
    path: destPath,
    ext,
    contentType,
    contentDisposition: header(headers, 'content-disposition'),
  }
}
