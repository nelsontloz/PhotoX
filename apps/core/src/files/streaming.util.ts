import type { Request, Response } from 'express'
import type { FileRecord } from '../database/entities'
import type { UserFilesService } from './user/user-files.service'

const BYTES_CACHE_CONTROL = 'private, max-age=31536000, immutable'

// send re-evaluates conditional/If-Range headers itself (412/304/ignore-range); the previous
// hand-rolled handler never did, so these are dropped before sendFile reads the request.
const CONDITIONAL_HEADERS = [
  'if-match',
  'if-unmodified-since',
  'if-none-match',
  'if-modified-since',
  'if-range',
]

/**
 * Builds an injection-safe `Content-Disposition: attachment` value. The quoted ASCII fallback
 * replaces `"`, `\`, `;` and non-ASCII bytes with `_`; the RFC5987 `filename*` carries the real
 * (percent-encoded) name for modern browsers.
 */
export function attachmentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\;]/g, '_')
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

interface ServableFile {
  path: string
  record: Pick<FileRecord, 'mimeType' | 'checksumSha256'>
}

/**
 * Sends a file from local disk via `res.sendFile`, which owns Range/206/416 and `Accept-Ranges`.
 * The strong checksum `ETag` and `Cache-Control` are set first so send never writes its own weak
 * fs `ETag` (`etag: false`).
 * - A full GET whose ETag is fresh short-circuits to 304 before any body headers exist; ranged
 *   requests still answer 206 even when `If-None-Match` matches (previous behavior).
 * - The 416 keeps `Content-Range: bytes, slash, total`; `Content-Disposition` keeps the RFC5987
 *   fallback; client close destroys the read stream (send's `onFinished`) and a mid-stream error
 *   destroys the response (callback below).
 */
export function pipeFileResponse(
  req: Request,
  res: Response,
  file: ServableFile,
  disposition?: string,
): void {
  res.set({
    ETag: `"${file.record.checksumSha256}"`,
    'Cache-Control': BYTES_CACHE_CONTROL,
    'X-Content-Type-Options': 'nosniff',
  })

  if (!req.headers.range && req.fresh) {
    res.status(304).end()
    return
  }

  for (const header of CONDITIONAL_HEADERS) delete req.headers[header]

  res.set({
    'Content-Type': file.record.mimeType,
    ...(disposition ? { 'Content-Disposition': disposition } : {}),
  })
  // Callback form keeps send's errors (416 incl. `Content-Range: bytes */total`, missing bytes,
  // mid-stream reads) out of Nest's exception layer, which would map them to 500.
  res.sendFile(file.path, { etag: false, lastModified: false }, (err) => {
    if (!err) return
    const cause = err as Error & { code?: string; status?: number }
    if (res.headersSent || cause.code === 'ECONNABORTED') {
      // mid-stream failure or client abort: same cleanup the previous stream.on('error') did
      res.destroy()
      return
    }
    res.status(cause.status ?? 500).end()
  })
}

/**
 * Resolve path → pipe, shared by the authenticated file routes and the public share routes.
 * `attachment: true` adds the Content-Disposition header (user downloads); public shares stream
 * inline.
 */
export async function serveFileBytes(
  req: Request,
  res: Response,
  files: UserFilesService,
  fileId: string,
  opts: { attachment?: boolean } = {},
): Promise<void> {
  const { path, record } = await files.serve(fileId)
  pipeFileResponse(
    req,
    res,
    { path, record },
    opts.attachment ? attachmentDisposition(record.originalName) : undefined,
  )
}
