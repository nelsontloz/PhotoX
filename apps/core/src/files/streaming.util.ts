import type { Readable } from 'stream'
import type { Response } from 'express'
import type { FileRecord } from '../database/entities'

export const RANGE_RE = /^bytes=(\d+)-(\d*)$/

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

type FileStreamRecord = Pick<FileRecord, 'mimeType'>

/**
 * Sends a file byte stream over an Express response.
 * - `range === null`: unsatisfiable range -> 416 + `Content-Range` (bytes, slash, total).
 * - `range` set: 206 + Content-Range/Content-Length/Accept-Ranges.
 * - `range` omitted: full body, Content-Length/Accept-Ranges only when `totalSize` is
 *   provided (the download route omits it to stream without either header), plus the
 *   optional `Content-Disposition`.
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
    }

export function pipeFileResponse(res: Response, opts: PipeFileResponseOptions): void {
  if (opts.range === null) {
    res.set('Content-Range', `bytes */${opts.totalSize}`)
    res.status(416).end()
    return
  }

  const { stream, record } = opts
  if (opts.range) {
    const { start, end } = opts.range
    res.set({
      'Content-Type': record.mimeType,
      'Content-Range': `bytes ${start}-${end}/${opts.totalSize}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    })
    res.status(206)
  } else {
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
