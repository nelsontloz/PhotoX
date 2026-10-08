import type { Readable } from 'stream'
import type { Response } from 'express'
import type { FileRecord } from '../database/entities'
import { etagMatches } from '../assets/assets.controller'

export const RANGE_RE = /^bytes=(\d+)-(\d*)$/

const BYTES_CACHE_CONTROL = 'private, max-age=31536000, immutable'

export function parseRangeHeader(
  rangeHeader: string,
  totalSize: number,
): { start: number; end: number } | null {
  const match = RANGE_RE.exec(rangeHeader)
  if (!match) return null
  const start = Number(match[1])
  if (!Number.isFinite(start) || start < 0 || start >= totalSize) return null
  const endStr = match[2]
  const end = endStr ? Number(endStr) : totalSize - 1
  if (!Number.isFinite(end) || end < start) {
    return { start, end: totalSize - 1 }
  }
  return { start, end: Math.min(end, totalSize - 1) }
}

type FileStreamRecord = Pick<FileRecord, 'mimeType' | 'checksumSha256'>

/**
 * Sends a file byte stream over an Express response.
 * - `range === null`: unsatisfiable range -> 416 + `Content-Range` (bytes, slash, total).
 * - `range` set: 206 + Content-Range/Content-Length/Accept-Ranges.
 * - `range` omitted: full body, Content-Length/Accept-Ranges only when `totalSize` is
 *   provided (the download route omits it to stream without either header), plus the
 *   optional `Content-Disposition`.
 * - 206 and full-body responses carry a strong `ETag` (the immutable `checksumSha256`) and
 *   `Cache-Control: private, max-age=31536000, immutable`. A matching `ifNoneMatch` on a
 *   full (non-Range) GET short-circuits to 304 with no body headers.
 */
export type PipeFileResponseOptions =
  | { range: null; totalSize: number }
  | {
      range: { start: number; end: number }
      totalSize: number
      stream: Readable
      record: FileStreamRecord
      disposition?: string
    }
  | {
      range?: undefined
      totalSize?: number
      stream: Readable
      record: FileStreamRecord
      disposition?: string
      ifNoneMatch?: string
    }

export function pipeFileResponse(res: Response, opts: PipeFileResponseOptions): void {
  if (opts.range === null) {
    res.set('Content-Range', `bytes */${opts.totalSize}`)
    res.status(416).end()
    return
  }

  const { stream, record } = opts
  const etag = `"${record.checksumSha256}"`
  res.set({
    ETag: etag,
    'Cache-Control': BYTES_CACHE_CONTROL,
    'X-Content-Type-Options': 'nosniff',
  })
  if (opts.range) {
    const { start, end } = opts.range
    res.set({
      'Content-Type': record.mimeType,
      'Content-Range': `bytes ${start}-${end}/${opts.totalSize}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      ...(opts.disposition ? { 'Content-Disposition': opts.disposition } : {}),
    })
    res.status(206)
  } else {
    if (opts.ifNoneMatch && etagMatches(opts.ifNoneMatch, etag)) {
      stream.destroy()
      res.status(304).end()
      return
    }
    res.set({
      'Content-Type': record.mimeType,
      ...(opts.totalSize !== undefined ? { 'Content-Length': String(opts.totalSize) } : {}),
      ...(opts.disposition ? { 'Content-Disposition': opts.disposition } : {}),
      ...(opts.totalSize !== undefined ? { 'Accept-Ranges': 'bytes' } : {}),
    })
  }

  stream.on('error', () => {
    res.destroy()
  })
  res.on('close', () => {
    stream.destroy()
  })
  stream.pipe(res)
}
