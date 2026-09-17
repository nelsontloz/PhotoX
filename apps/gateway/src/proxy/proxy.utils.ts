import type { IncomingHttpHeaders } from 'node:http'
import type { Request } from 'express'
import type { GatewayIdentity } from '../auth/gateway-auth.guard'

// ponytail: 1h upload timeout mirrors the largest client timeout (3600s);
// download timeout mirrors the web 300s blob-download timeout; per-request
// timeouts, not a shared client — no pooling needed for personal scale
export const PROXY_UPLOAD_TIMEOUT_MS = 3_600_000
export const PROXY_DOWNLOAD_TIMEOUT_MS = 300_000
export const PROXY_DEFAULT_TIMEOUT_MS = 120_000

const REQUEST_HOP_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

// ponytail: fetch manages framing itself, and identity/credentials are gateway-owned
const REQUEST_STRIP_HEADERS = new Set([
  'authorization',
  'cookie',
  'content-length',
  ...REQUEST_HOP_HEADERS,
])

export const RESPONSE_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export function buildTargetUrl(coreBaseUrl: string, originalUrl: string): string {
  const base = coreBaseUrl.replace(/\/$/, '')
  const q = originalUrl.indexOf('?')
  if (q === -1) return base + originalUrl
  const params = new URLSearchParams(originalUrl.slice(q + 1))
  params.delete('userId')
  const query = params.toString()
  return base + originalUrl.slice(0, q) + (query ? `?${query}` : '')
}

export function buildProxyHeaders(
  incoming: IncomingHttpHeaders,
  user: GatewayIdentity | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(incoming)) {
    const name = key.toLowerCase()
    if (REQUEST_STRIP_HEADERS.has(name) || name.startsWith('x-user-')) continue
    if (value === undefined) continue
    out[name] = Array.isArray(value) ? value.join(', ') : value
  }
  if (user) {
    out['x-user-id'] = user.id
    out['x-user-email'] = user.email
    out['x-user-role'] = user.role
  }
  return out
}

export function isMultipart(contentType: string | string[] | undefined): boolean {
  return firstHeader(contentType).toLowerCase().includes('multipart/')
}

export function selectProxyTimeout(
  method: string,
  contentType: string | string[] | undefined,
): number {
  if (isMultipart(contentType)) return PROXY_UPLOAD_TIMEOUT_MS
  if (method === 'GET') return PROXY_DOWNLOAD_TIMEOUT_MS
  return PROXY_DEFAULT_TIMEOUT_MS
}

function firstHeader(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value
  return value?.join(', ') ?? ''
}

function appendFormValue(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    params.append(key, String(value))
  } else if (Array.isArray(value)) {
    // ponytail: urlencoded bodies are flat — nested objects dropped, arrays repeated
    for (const item of value as unknown[]) appendFormValue(params, key, item)
  }
}

export function stripUserIdFromJsonBody<T>(body: T): T {
  if (Array.isArray(body)) return body.map(stripUserIdFromJsonBody) as T
  if (body !== null && typeof body === 'object') {
    const copy = { ...(body as Record<string, unknown>) }
    delete copy.userId
    return copy as T
  }
  return body
}

export function serializeFormWithoutUserId(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (key === 'userId') continue
    appendFormValue(params, key, value)
  }
  return params.toString()
}

// JSON/urlencoded bodies were consumed by the body parsers — re-serialize them.
// Multipart and unknown types skip the parsers, so the raw stream is still live.
export function buildProxyBody(req: Request): string | Request | undefined {
  const ct = firstHeader(req.headers['content-type'])
  if (ct.toLowerCase().includes('application/json')) {
    const body = req.body as unknown
    return body === undefined || body === null ? undefined : JSON.stringify(stripUserIdFromJsonBody(body))
  }
  if (ct.toLowerCase().includes('application/x-www-form-urlencoded')) {
    return serializeFormWithoutUserId(req.body)
  }
  const length = Number(req.headers['content-length'] ?? 0)
  if (length > 0 || req.headers['transfer-encoding'] !== undefined) return req
  return undefined
}
