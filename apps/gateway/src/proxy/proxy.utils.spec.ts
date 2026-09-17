import {
  buildProxyBody,
  buildProxyHeaders,
  buildTargetUrl,
  PROXY_DEFAULT_TIMEOUT_MS,
  PROXY_DOWNLOAD_TIMEOUT_MS,
  PROXY_UPLOAD_TIMEOUT_MS,
  selectProxyTimeout,
  serializeFormWithoutUserId,
  stripUserIdFromJsonBody,
} from './proxy.utils'

describe('buildTargetUrl', () => {
  it('strips userId but preserves other params', () => {
    expect(buildTargetUrl('http://core:3000', '/api/v1/assets?userId=evil&limit=20')).toBe(
      'http://core:3000/api/v1/assets?limit=20',
    )
  })

  it('leaves urls without a query alone', () => {
    expect(buildTargetUrl('http://core:3000/', '/api/share/abc/stream')).toBe(
      'http://core:3000/api/share/abc/stream',
    )
  })
})

describe('buildProxyHeaders', () => {
  it('strips hop-by-hop, auth, cookies, content-length and spoofed identity', () => {
    const headers = buildProxyHeaders(
      {
        host: 'gw:3001',
        connection: 'keep-alive',
        authorization: 'Bearer abc',
        cookie: 'sess=1',
        'content-length': '42',
        'content-type': 'application/json',
        range: 'bytes=0-99',
        'x-request-id': 'r1',
        'x-user-id': 'spoofed',
      },
      { id: 'u1', email: 'u@example.com', role: 'user' },
    )
    expect(headers).toEqual({
      'content-type': 'application/json',
      range: 'bytes=0-99',
      'x-request-id': 'r1',
      'x-user-id': 'u1',
      'x-user-email': 'u@example.com',
      'x-user-role': 'user',
    })
  })

  it('drops client identity headers on open routes (no user)', () => {
    const headers = buildProxyHeaders({ 'x-user-id': 'spoofed' }, undefined)
    expect(headers).toEqual({})
  })
})

describe('stripUserIdFromJsonBody', () => {
  it('removes top-level userId without mutating', () => {
    const body = { userId: 'evil', favorite: true }
    expect(stripUserIdFromJsonBody(body)).toEqual({ favorite: true })
    expect(body).toEqual({ userId: 'evil', favorite: true })
  })

  it('handles arrays and primitives', () => {
    expect(stripUserIdFromJsonBody([{ userId: 'x', a: 1 }])).toEqual([{ a: 1 }])
    expect(stripUserIdFromJsonBody(null)).toBe(null)
  })
})

describe('serializeFormWithoutUserId', () => {
  it('re-encodes the form minus userId', () => {
    expect(serializeFormWithoutUserId({ userId: 'evil', title: 'hi' })).toBe('title=hi')
  })
})

describe('selectProxyTimeout', () => {
  // ponytail: route→timeout mapping pinned here — Gate 2 REQUIRED FIX
  // (120s default truncated 300s client downloads)
  const cases: [string, string | undefined, number][] = [
    ['POST', 'multipart/form-data; boundary=x', PROXY_UPLOAD_TIMEOUT_MS],
    ['PUT', 'multipart/related', PROXY_UPLOAD_TIMEOUT_MS],
    ['GET', undefined, PROXY_DOWNLOAD_TIMEOUT_MS],
    ['GET', 'video/mp4', PROXY_DOWNLOAD_TIMEOUT_MS],
    ['GET', 'application/json', PROXY_DOWNLOAD_TIMEOUT_MS],
    ['HEAD', undefined, PROXY_DEFAULT_TIMEOUT_MS],
    ['POST', 'application/json', PROXY_DEFAULT_TIMEOUT_MS],
    ['PATCH', 'application/json', PROXY_DEFAULT_TIMEOUT_MS],
    ['DELETE', undefined, PROXY_DEFAULT_TIMEOUT_MS],
  ]
  it.each(cases)('%s %s → %sms', (method, contentType, expected) => {
    expect(selectProxyTimeout(method, contentType)).toBe(expected)
  })

  it('gives downloads at least the 300s client timeout', () => {
    expect(PROXY_DOWNLOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(300_000)
  })
})

describe('buildProxyBody', () => {
  it('re-serializes stripped JSON bodies', () => {
    const req = {
      headers: { 'content-type': 'application/json' },
      body: { userId: 'evil', favorite: true },
    } as unknown as import('express').Request
    expect(buildProxyBody(req)).toBe(JSON.stringify({ favorite: true }))
  })
})
